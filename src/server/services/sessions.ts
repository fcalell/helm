import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "@fcalell/plugin-api/error";
import { type ChannelHandle, defineService } from "@fcalell/plugin-node/server";
import { createShapingThread, slugify } from "../../board/create.ts";
import {
	attachEpicSession,
	attachShapingSession,
	boardDir,
	EPIC_DIR_RE,
	epicFilePath,
	isENOENT,
	readEpicFile,
	readShapingFile,
	readStoryFile,
	shapingPath,
	writeStory,
} from "../../board/store.ts";
import { KIND_REGISTRY, type SessionKind } from "../../sessions/kinds.ts";
import {
	refineSeedPrompt,
	reseedPrompt,
	steeringPrompt,
} from "../../sessions/prompts.ts";
import {
	type SessionProcess,
	SessionSpawnError,
	spawnSessionProcess,
} from "../../sessions/runner.ts";
import { sessionChannel } from "../../shared/channels.ts";
import {
	bindSessionId,
	mcpEndpointUrl,
	registerSpawn,
	releaseSpawn,
} from "../mcp/registry.ts";
import { enqueueWrite } from "../write-queue.ts";
import { boardSnapshot, managedRepo } from "./board.ts";

// The card a session's id persists on. `refine` attaches to a story,
// `define` to an epic, and `shape` to a shaping thread (its id is the thread
// slug); the cold kinds never attach (they never resume, so nothing stores
// their id).
export type Attach = { type: "story" | "epic" | "shaping"; id: string };

interface SessionInfo {
	kind: SessionKind;
	attach?: Attach;
}

// Module singletons: routes import the functions below directly.
// `known`/`interrupted` are in-memory only; after a restart a card-attached
// session is recovered from frontmatter (`findOnBoard`).
const live = new Map<string, SessionProcess>();
const known = new Map<string, SessionInfo>();
const interrupted = new Set<string>();
const closedListeners = new Set<
	(info: { sessionId?: string; stale: boolean }) => void
>();
let handle: ChannelHandle<(typeof sessionChannel)["server"]> | undefined;

// The proposals service subscribes to flush held resumes when a turn ends.
export function onSessionClosed(
	listener: (info: { sessionId?: string; stale: boolean }) => void,
): void {
	closedListeners.add(listener);
}

export function isSessionLive(sessionId: string): boolean {
	return live.has(sessionId);
}

export interface SpawnSessionInput {
	kind: SessionKind;
	storyId?: string;
	epicId?: string;
	prompt: string;
}

export async function spawnSession(
	input: SpawnSessionInput,
): Promise<{ sessionId: string }> {
	const attach =
		input.kind === "shape"
			? await createShapeThread(input.prompt)
			: await resolveAttach(input);
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
	const mcpToken = randomUUID();
	registerSpawn(mcpToken, { kind, attach });
	let sessionId = options.resume;
	let resultSeen = false;
	let child: ReturnType<typeof spawnSessionProcess>;
	try {
		child = spawnSessionProcess({
			kind,
			cwd: managedRepo().path,
			prompt: options.prompt,
			resume: options.resume,
			seedSystemPrompt:
				options.resume === undefined ? await seedFor(kind, attach) : undefined,
			mcpUrl: mcpEndpointUrl(mcpToken),
			onEvent: (event) => {
				if (event.session_id !== undefined) {
					sessionId = event.session_id;
					bindSessionId(mcpToken, event.session_id);
				}
				if (event.type === "result") resultSeen = true;
				handle?.broadcast("event", { runId, kind, sessionId, event });
			},
		});
	} catch (error) {
		// A synchronous spawn throw (a kind with no spawnable row) would
		// otherwise leak the binding: the done handler below never registers.
		releaseSpawn(mcpToken);
		throw error;
	}
	void child.done.then((outcome) => {
		releaseSpawn(mcpToken);
		if (sessionId !== undefined) {
			live.delete(sessionId);
			// A turn that ended without a result event was interrupted (kill or
			// crash); the next resume must state that (steeringPrompt).
			if (resultSeen || outcome.stale) interrupted.delete(sessionId);
			else interrupted.add(sessionId);
		}
		for (const listener of closedListeners) {
			listener({ sessionId, stale: outcome.stale });
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

// A fresh refine turn (first spawn or reseed) is seeded with the epic's
// conclusions and the card through the system prompt, so the seed never
// clutters the transcript.
async function seedFor(
	kind: SessionKind,
	attach: Attach | undefined,
): Promise<string | undefined> {
	if (kind !== "refine" || attach?.type !== "story") return undefined;
	const story = findStory(attach.id);
	const raw = (await readStoryFile(story.path, story.epicId)).raw;
	const epic = boardSnapshot().epics.find((each) => each.id === story.epicId);
	return refineSeedPrompt(raw, epic?.body);
}

function asSpawnFailed(error: unknown): unknown {
	if (!(error instanceof SessionSpawnError)) return error;
	return new ApiError("SPAWN_FAILED", { message: error.message });
}

async function resolveAttach(
	input: SpawnSessionInput,
): Promise<Attach | undefined> {
	if (input.kind === "refine") {
		if (input.storyId === undefined) {
			throw new ApiError("BAD_REQUEST", {
				message: "refine sessions attach to a story: storyId is required",
			});
		}
		const story = findStory(input.storyId);
		const status = story.frontmatter.status;
		if (status !== "backlog" && status !== "refining") {
			throw new ApiError("ILLEGAL_TRANSITION", {
				status: 409,
				message: `a ${status} story cannot enter refining`,
				data: {
					from: status,
					to: "refining",
					reason: `a ${status} story cannot enter refining`,
				},
			});
		}
		return { type: "story", id: input.storyId };
	}
	if (input.kind === "define") {
		if (input.epicId === undefined) {
			throw new ApiError("BAD_REQUEST", {
				message: "define sessions attach to an epic: epicId is required",
			});
		}
		await findEpicPath(input.epicId);
		return { type: "epic", id: input.epicId };
	}
	return undefined;
}

const SLUG_WORDS = 6;

function shapeSeedTitle(prompt: string): string {
	const firstLine = prompt.trim().split("\n", 1)[0] ?? "";
	const words = firstLine.split(/\s+/).slice(0, SLUG_WORDS).join(" ");
	return words === "" ? "Shaping" : words;
}

function isEEXIST(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

async function createShapeThread(prompt: string): Promise<Attach> {
	const repoPath = managedRepo().path;
	const title = shapeSeedTitle(prompt);
	const base = slugify(title);
	let slug = base;
	for (let n = 2; ; n++) {
		try {
			await enqueueWrite(() =>
				createShapingThread(repoPath, slug, title, prompt),
			);
			return { type: "shaping", id: slug };
		} catch (error) {
			if (!isEEXIST(error)) throw error;
			slug = `${base}-${n}`;
		}
	}
}

function findStory(id: string) {
	const story = boardSnapshot().stories.find((story) => story.id === id);
	if (story === undefined) {
		throw new ApiError("NOT_FOUND", { message: `no story with id ${id}` });
	}
	return story;
}

// Snapshot lookup with a disk fallback: an epic created moments ago (the `n`
// entry spawns its define chat right after `epic.create`) can precede the
// watcher's next snapshot by a few hundred milliseconds.
async function findEpicPath(id: string): Promise<string> {
	const epic = boardSnapshot().epics.find((epic) => epic.id === id);
	if (epic !== undefined) return epic.path;
	const dir = boardDir(managedRepo().path);
	try {
		for (const name of await readdir(dir)) {
			if (EPIC_DIR_RE.exec(name)?.[1] === id) {
				return epicFilePath(join(dir, name));
			}
		}
	} catch (error) {
		if (!isENOENT(error)) throw error;
	}
	throw new ApiError("NOT_FOUND", { message: `no epic with id ${id}` });
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
	const thread = board.shaping.find(
		(thread) => thread.frontmatter.sessions.shape === sessionId,
	);
	if (thread !== undefined) {
		return { kind: "shape", attach: { type: "shaping", id: thread.slug } };
	}
	return undefined;
}

async function persistAttach(attach: Attach, sessionId: string): Promise<void> {
	if (attach.type === "story") {
		// One write attaches the session and enters refining: `r` on a Backlog
		// card flips it in the same move.
		const story = findStory(attach.id);
		await enqueueWrite(async () => {
			const current = await readStoryFile(story.path, story.epicId);
			await writeStory({
				path: current.path,
				frontmatter: {
					...current.frontmatter,
					status:
						current.frontmatter.status === "backlog"
							? "refining"
							: current.frontmatter.status,
					sessions: { ...current.frontmatter.sessions, refine: sessionId },
				},
				body: current.body,
			});
		});
	} else if (attach.type === "epic") {
		const path = await findEpicPath(attach.id);
		await enqueueWrite(() => attachEpicSession(path, "define", sessionId));
	} else {
		await enqueueWrite(() =>
			attachShapingSession(
				shapingPath(managedRepo().path, attach.id),
				sessionId,
			),
		);
	}
}

async function readCardRaw(attach: Attach): Promise<string> {
	if (attach.type === "story") {
		const story = findStory(attach.id);
		return (await readStoryFile(story.path, story.epicId)).raw;
	}
	if (attach.type === "epic") {
		return (await readEpicFile(await findEpicPath(attach.id))).raw;
	}
	return (await readShapingFile(shapingPath(managedRepo().path, attach.id)))
		.raw;
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
