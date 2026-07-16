import { randomUUID } from "node:crypto";
import { ApiError } from "@fcalell/plugin-api/error";
import { type ChannelHandle, defineService } from "@fcalell/plugin-node/server";
import {
	attachEpicSession,
	attachStorySession,
	readEpicFile,
	readStoryFile,
} from "../../board/store.ts";
import { KIND_REGISTRY, type SessionKind } from "../../sessions/kinds.ts";
import { reseedPrompt, steeringPrompt } from "../../sessions/prompts.ts";
import {
	type SessionProcess,
	SessionSpawnError,
	spawnSessionProcess,
} from "../../sessions/runner.ts";
import { sessionChannel } from "../../shared/channels.ts";
import { enqueueWrite } from "../write-queue.ts";
import { boardSnapshot, managedRepo } from "./board.ts";

// The card a session's id persists on. `refine` attaches to a story and
// `define` to an epic; shaping threads join in 001-04, and the cold kinds
// never attach (they never resume, so nothing stores their id).
type Attach = { type: "story" | "epic"; id: string };

interface SessionInfo {
	kind: SessionKind;
	attach?: Attach;
}

// Module singletons, board-service style: routes import the functions below
// directly. `known`/`interrupted` are in-memory only; after a restart a
// card-attached session is recovered from frontmatter (`findOnBoard`).
const live = new Map<string, SessionProcess>();
const known = new Map<string, SessionInfo>();
const interrupted = new Set<string>();
let handle: ChannelHandle<(typeof sessionChannel)["server"]> | undefined;

export interface SpawnSessionInput {
	kind: SessionKind;
	storyId?: string;
	epicId?: string;
	prompt: string;
}

export async function spawnSession(
	input: SpawnSessionInput,
): Promise<{ sessionId: string }> {
	const attach = resolveAttach(input);
	try {
		return await runTurn({ kind: input.kind, prompt: input.prompt, attach });
	} catch (error) {
		throw asSpawnFailed(error);
	}
}

export async function messageSession(input: {
	sessionId: string;
	prompt: string;
}): Promise<{ sessionId: string }> {
	const info = known.get(input.sessionId) ?? findOnBoard(input.sessionId);
	if (info === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no session with id ${input.sessionId}`,
		});
	}
	if (KIND_REGISTRY[info.kind].context === "always-cold") {
		throw new ApiError("SESSION_COLD", {
			status: 409,
			message: `${info.kind} sessions never resume; spawn a fresh one`,
		});
	}
	if (live.has(input.sessionId)) {
		throw new ApiError("SESSION_BUSY", {
			status: 409,
			message: "session is mid-turn; kill it before steering",
		});
	}
	const prompt = interrupted.has(input.sessionId)
		? steeringPrompt(input.prompt)
		: input.prompt;
	try {
		return await runTurn({
			kind: info.kind,
			prompt,
			resume: input.sessionId,
			attach: info.attach,
		});
	} catch (error) {
		if (!(error instanceof SessionSpawnError) || !error.stale) {
			throw asSpawnFailed(error);
		}
		if (info.attach === undefined) {
			throw new ApiError("SESSION_STALE", {
				status: 410,
				message:
					"the transcript is gone and the session has no card to reseed from",
			});
		}
		known.delete(input.sessionId);
		interrupted.delete(input.sessionId);
		const raw = await readCardRaw(info.attach);
		try {
			return await runTurn({
				kind: info.kind,
				prompt: reseedPrompt(raw, input.prompt),
				attach: info.attach,
			});
		} catch (reseedError) {
			throw asSpawnFailed(reseedError);
		}
	}
}

export function killSession(sessionId: string): void {
	const child = live.get(sessionId);
	if (child === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no live session with id ${sessionId}`,
		});
	}
	child.kill();
}

interface TurnOptions {
	kind: SessionKind;
	prompt: string;
	resume?: string;
	attach?: Attach;
}

async function runTurn(options: TurnOptions): Promise<{ sessionId: string }> {
	const runId = randomUUID();
	const { kind, attach } = options;
	let sessionId = options.resume;
	let resultSeen = false;
	const child = spawnSessionProcess({
		kind,
		cwd: managedRepo().path,
		prompt: options.prompt,
		resume: options.resume,
		onEvent: (event) => {
			if (event.session_id !== undefined) sessionId = event.session_id;
			if (event.type === "result") resultSeen = true;
			handle?.broadcast("event", { runId, kind, sessionId, event });
		},
	});
	void child.done.then((outcome) => {
		if (sessionId !== undefined) {
			live.delete(sessionId);
			// A turn that ended without a result event was interrupted (kill or
			// crash); the next resume must state that (steeringPrompt).
			if (resultSeen || outcome.stale) interrupted.delete(sessionId);
			else interrupted.add(sessionId);
		}
		handle?.broadcast("closed", {
			runId,
			kind,
			sessionId,
			exitCode: outcome.exitCode,
			signal: outcome.signal,
			stale: outcome.stale,
		});
	});
	const init = await child.started;
	live.set(init.sessionId, child);
	known.set(init.sessionId, { kind, attach });
	if (attach !== undefined && options.resume !== init.sessionId) {
		await persistAttach(attach, init.sessionId);
	}
	return { sessionId: init.sessionId };
}

function asSpawnFailed(error: unknown): unknown {
	if (!(error instanceof SessionSpawnError)) return error;
	return new ApiError("SPAWN_FAILED", { message: error.message });
}

function resolveAttach(input: SpawnSessionInput): Attach | undefined {
	if (input.kind === "refine") {
		if (input.storyId === undefined) {
			throw new ApiError("BAD_REQUEST", {
				message: "refine sessions attach to a story: storyId is required",
			});
		}
		findStory(input.storyId);
		return { type: "story", id: input.storyId };
	}
	if (input.kind === "define") {
		if (input.epicId === undefined) {
			throw new ApiError("BAD_REQUEST", {
				message: "define sessions attach to an epic: epicId is required",
			});
		}
		findEpic(input.epicId);
		return { type: "epic", id: input.epicId };
	}
	return undefined;
}

function findStory(id: string) {
	const story = boardSnapshot().stories.find((story) => story.id === id);
	if (story === undefined) {
		throw new ApiError("NOT_FOUND", { message: `no story with id ${id}` });
	}
	return story;
}

function findEpic(id: string) {
	const epic = boardSnapshot().epics.find((epic) => epic.id === id);
	if (epic === undefined) {
		throw new ApiError("NOT_FOUND", { message: `no epic with id ${id}` });
	}
	return epic;
}

function findOnBoard(sessionId: string): SessionInfo | undefined {
	const board = boardSnapshot();
	const story = board.stories.find(
		(story) => story.frontmatter.sessions.refine === sessionId,
	);
	if (story !== undefined) {
		return { kind: "refine", attach: { type: "story", id: story.id } };
	}
	const epic = board.epics.find(
		(epic) => epic.frontmatter.sessions.define === sessionId,
	);
	if (epic !== undefined) {
		return { kind: "define", attach: { type: "epic", id: epic.id } };
	}
	return undefined;
}

async function persistAttach(attach: Attach, sessionId: string): Promise<void> {
	if (attach.type === "story") {
		const story = findStory(attach.id);
		await enqueueWrite(() =>
			attachStorySession(story.path, story.epicId, "refine", sessionId),
		);
	} else {
		const epic = findEpic(attach.id);
		await enqueueWrite(() => attachEpicSession(epic.path, "define", sessionId));
	}
}

async function readCardRaw(attach: Attach): Promise<string> {
	if (attach.type === "story") {
		const story = findStory(attach.id);
		return (await readStoryFile(story.path, story.epicId)).raw;
	}
	const epic = findEpic(attach.id);
	return (await readEpicFile(epic.path)).raw;
}

export default defineService({
	name: "sessions",
	start: (ctx) => {
		handle = ctx.ws.channel(sessionChannel);
		return () => {
			handle = undefined;
			for (const child of live.values()) child.kill();
			live.clear();
			known.clear();
			interrupted.clear();
		};
	},
});
