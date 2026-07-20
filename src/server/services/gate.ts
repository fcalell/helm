import { ApiError } from "@fcalell/plugin-api/error";
import { type ChannelHandle, defineService } from "@fcalell/plugin-node/server";
import { briefHash } from "../../board/hash.ts";
import { appendOpenQuestion } from "../../board/markdown.ts";
import type { Gate, Status } from "../../board/schema.ts";
import {
	InvalidBoardFileError,
	isENOENT,
	readStoryFile,
	type Story,
	writeStory,
} from "../../board/store.ts";
import {
	canTransition,
	checkReadyGate,
	LEGAL_TRANSITIONS,
	verdictValid,
} from "../../board/transitions.ts";
import { adversaryPrompt, gateFlagsPrompt } from "../../sessions/prompts.ts";
import { gateChannel } from "../../shared/channels.ts";
import type {
	GateFlagResolution,
	GatePhase,
	GateRound,
	GateSnapshot,
} from "../../shared/gate.ts";
import { dispatch } from "../dispatcher.ts";
import type { ReadyBinding } from "../mcp/registry.ts";
import type { ContestFlagPayload, FlagRiskPayload } from "../mcp/schemas.ts";
import { enqueueWrite } from "../write-queue.ts";
import { boardSnapshot } from "./board.ts";
import { messageSession, onSessionClosed, runColdSession } from "./sessions.ts";

// One ready-gate attempt per story, in memory only (like pending proposals):
// a restart drops it and the next move-to-ready starts fresh. The `gate`
// frontmatter block is the durable outcome.
interface Attempt {
	storyId: string;
	phase: GatePhase;
	// Hash of the brief body the current round's adversary read; a verdict
	// landing after an edit fails this check and is discarded.
	briefHash: string;
	rounds: GateRound[];
	overrides: string[];
	adversarySessionId?: string;
	refineSessionId?: string;
	// Flags answered by a pending fix proposal; never concede these at turn end.
	pendingFixes: Set<string>;
	// The flags prompt hit a mid-turn refine session; retried on its close.
	pendingFlags?: boolean;
}

const attempts = new Map<string, Attempt>();
let handle: ChannelHandle<(typeof gateChannel)["server"]> | undefined;
let log: { error(message: string): void } | undefined;

function snapshot(): GateSnapshot {
	return {
		attempts: [...attempts.values()].map((attempt) => ({
			storyId: attempt.storyId,
			phase: attempt.phase,
			rounds: attempt.rounds,
			overrides: attempt.overrides,
		})),
	};
}

function broadcast(): void {
	handle?.broadcast("snapshot", snapshot());
}

function setPhase(attempt: Attempt, phase: GatePhase): void {
	attempt.phase = phase;
	broadcast();
}

function abort(attempt: Attempt): void {
	if (attempts.get(attempt.storyId) !== attempt) return;
	attempts.delete(attempt.storyId);
	broadcast();
}

function currentRound(attempt: Attempt): GateRound | undefined {
	return attempt.rounds[attempt.rounds.length - 1];
}

function logError(error: unknown): void {
	log?.error(`gate: ${String(error)}`);
}

function logAndAbort(attempt: Attempt, error: unknown): void {
	logError(error);
	abort(attempt);
}

async function readFresh(storyId: string): Promise<Story> {
	const known = boardSnapshot().stories.find((story) => story.id === storyId);
	if (known === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no story with id ${storyId}`,
		});
	}
	try {
		return await readStoryFile(known.path, known.epicId);
	} catch (error) {
		if (isENOENT(error)) {
			throw new ApiError("NOT_FOUND", {
				message: `no story with id ${storyId}`,
			});
		}
		if (error instanceof InvalidBoardFileError) {
			throw new ApiError("INVALID_FILE", {
				status: 409,
				message: error.message,
			});
		}
		throw error;
	}
}

function illegal(from: Status, reason: string) {
	return new ApiError("ILLEGAL_TRANSITION", {
		status: 409,
		message: reason,
		data: { from, to: "ready", reason },
	});
}

export async function requestReady(id: string): Promise<{ gating: boolean }> {
	return enqueueWrite(async () => {
		const current = await readFresh(id);
		const from = current.frontmatter.status;
		const targets: readonly Status[] = LEGAL_TRANSITIONS[from];
		if (!targets.includes("ready")) {
			throw illegal(from, `a ${from} story cannot move to ready`);
		}
		const complete = checkReadyGate(current.brief);
		if (!complete.ok) throw illegal(from, complete.reason);
		if (verdictValid(current.frontmatter.gate, current.body)) {
			await writeStory({
				path: current.path,
				frontmatter: { ...current.frontmatter, status: "ready" },
				body: current.body,
			});
			return { gating: false };
		}
		if (from !== "refining") {
			throw illegal(
				from,
				"no adversary verdict for this brief; move the story to refining and run the ready gate",
			);
		}
		const existing = attempts.get(id);
		if (existing !== undefined) {
			// A user retry: only an exhausted attempt gets a new (manual) round.
			if (existing.phase === "exhausted") enqueueRound(existing);
			return { gating: true };
		}
		const attempt: Attempt = {
			storyId: id,
			phase: "queued",
			briefHash: briefHash(current.body),
			rounds: [],
			overrides: [],
			pendingFixes: new Set(),
		};
		attempts.set(id, attempt);
		enqueueRound(attempt);
		return { gating: true };
	});
}

function enqueueRound(attempt: Attempt): void {
	setPhase(attempt, "queued");
	void dispatch(() => runRound(attempt), {
		kind: "adversary",
		storyId: attempt.storyId,
	}).catch((error) => {
		logError(error);
		abort(attempt);
	});
}

async function runRound(attempt: Attempt): Promise<void> {
	if (attempts.get(attempt.storyId) !== attempt) return;
	const story = await readFresh(attempt.storyId).catch(() => undefined);
	if (story === undefined || story.frontmatter.status !== "refining") {
		abort(attempt);
		return;
	}
	attempt.briefHash = briefHash(story.body);
	attempt.rounds.push({ n: attempt.rounds.length + 1, flags: [] });
	setPhase(attempt, "adversary");
	const run = await runColdSession({
		kind: "adversary",
		prompt: adversaryPrompt(story.body, attempt.overrides),
		attach: { type: "story", id: attempt.storyId },
	});
	attempt.adversarySessionId = run.sessionId;
	await run.done;
	if (attempts.get(attempt.storyId) !== attempt) return;
	const after = await readFresh(attempt.storyId).catch(() => undefined);
	if (after === undefined || briefHash(after.body) !== attempt.briefHash) {
		// The brief moved mid-flight; the landing verdict is discarded.
		abort(attempt);
		return;
	}
	const round = currentRound(attempt);
	if (round === undefined || round.flags.length === 0) {
		await writePass(attempt);
		return;
	}
	await routeFlags(attempt);
}

async function routeFlags(attempt: Attempt): Promise<void> {
	const round = currentRound(attempt);
	if (round === undefined) return;
	const story = await readFresh(attempt.storyId).catch(() => undefined);
	const refineId = story?.frontmatter.sessions.refine;
	if (refineId === undefined) {
		concedeOpenFlags(attempt);
		setPhase(attempt, "review");
		return;
	}
	attempt.refineSessionId = refineId;
	setPhase(attempt, "refine");
	try {
		const { sessionId } = await messageSession({
			sessionId: refineId,
			prompt: gateFlagsPrompt(round.flags),
		});
		// A stale resume reseeds under a fresh id.
		attempt.refineSessionId = sessionId;
	} catch (error) {
		if (error instanceof ApiError && error.code === "SESSION_BUSY") {
			attempt.pendingFlags = true;
			return;
		}
		logError(error);
		concedeOpenFlags(attempt);
		setPhase(attempt, "review");
	}
}

// A flag left unanswered when the refine turn ends renders contested with no
// counter-argument, so a round never idles. A flag with a pending fix proposal
// is answered; it stays open until the user resolves the proposal.
function concedeOpenFlags(attempt: Attempt): void {
	for (const flag of currentRound(attempt)?.flags ?? []) {
		if (flag.status !== "open" || attempt.pendingFixes.has(flag.title))
			continue;
		flag.status = "contested";
	}
}

async function evaluate(attempt: Attempt): Promise<void> {
	if (attempts.get(attempt.storyId) !== attempt) return;
	if (attempt.phase !== "refine" && attempt.phase !== "review") return;
	const round = currentRound(attempt);
	if (round === undefined) return;
	if (round.flags.some((flag) => flag.status === "open")) return;
	if (round.flags.some((flag) => flag.status === "contested")) {
		if (attempt.phase === "refine") setPhase(attempt, "review");
		return;
	}
	const story = await readFresh(attempt.storyId).catch(() => undefined);
	if (story === undefined) {
		abort(attempt);
		return;
	}
	if (!checkReadyGate(story.brief).ok) {
		// An accepted flag's open question still blocks; resolving it re-runs
		// this check.
		if (attempt.phase === "refine") setPhase(attempt, "review");
		return;
	}
	if (briefHash(story.body) === attempt.briefHash) {
		await writePass(attempt);
		return;
	}
	if (attempt.rounds.length < 2) {
		enqueueRound(attempt);
		return;
	}
	setPhase(attempt, "exhausted");
}

async function writePass(attempt: Attempt): Promise<void> {
	try {
		await enqueueWrite(async () => {
			const story = await readFresh(attempt.storyId).catch(() => undefined);
			if (story === undefined) return;
			if (briefHash(story.body) !== attempt.briefHash) return;
			const gate: Gate = {
				passed: new Date().toISOString(),
				brief: attempt.briefHash,
				overrides: [...attempt.overrides],
			};
			const check = canTransition(story.frontmatter.status, "ready", {
				brief: story.brief,
				body: story.body,
				gate,
			});
			if (!check.ok) return;
			await writeStory({
				path: story.path,
				frontmatter: { ...story.frontmatter, status: "ready", gate },
				body: story.body,
			});
		});
	} catch (error) {
		abort(attempt);
		throw error;
	}
	abort(attempt);
}

// Tool entry: the adversary session's flag_risk. Returns an error message for
// the tool result, or undefined on success.
export function recordAdversaryFlag(
	binding: ReadyBinding,
	payload: FlagRiskPayload,
): string | undefined {
	const storyId = binding.attach?.type === "story" ? binding.attach.id : "";
	const attempt = attempts.get(storyId);
	if (
		attempt === undefined ||
		attempt.phase !== "adversary" ||
		attempt.adversarySessionId !== binding.sessionId
	) {
		return "no adversary round is running for this story";
	}
	const round = currentRound(attempt);
	if (round === undefined) return "no adversary round is running";
	if (round.flags.some((flag) => flag.title === payload.title)) {
		return `a flag titled "${payload.title}" already exists this round`;
	}
	round.flags.push({
		title: payload.title,
		detail: payload.detail,
		status: "open",
	});
	broadcast();
	return undefined;
}

// Tool entry: the refine session's contest_flag during an open round.
export function contestGateFlag(
	binding: ReadyBinding,
	payload: ContestFlagPayload,
): string | undefined {
	const storyId = binding.attach?.type === "story" ? binding.attach.id : "";
	const attempt = attempts.get(storyId);
	if (
		attempt === undefined ||
		(attempt.phase !== "refine" && attempt.phase !== "review")
	) {
		return "no gate round is open for this story";
	}
	const flag = currentRound(attempt)?.flags.find(
		(each) => each.title === payload.flag,
	);
	if (flag === undefined) {
		return `no flag titled "${payload.flag}" in the current round`;
	}
	if (
		flag.status !== "open" &&
		!(flag.status === "contested" && flag.argument === undefined)
	) {
		return `flag "${payload.flag}" is already ${flag.status}`;
	}
	flag.status = "contested";
	flag.argument = payload.argument;
	broadcast();
	return undefined;
}

// A story's brief changed through an accepted proposal. A fix (update_brief
// carrying `resolves`) settles its flag; either way the round re-evaluates.
export function gateBriefEdited(storyId: string, resolves?: string): void {
	const attempt = attempts.get(storyId);
	if (attempt === undefined) return;
	if (resolves !== undefined) {
		const flag = currentRound(attempt)?.flags.find(
			(each) =>
				each.title === resolves &&
				(each.status === "open" || each.status === "contested"),
		);
		if (flag !== undefined) {
			flag.status = "fixed";
			flag.argument = undefined;
			attempt.pendingFixes.delete(resolves);
			broadcast();
		}
	}
	void evaluate(attempt).catch((error) => logAndAbort(attempt, error));
}

// The refine session answered a flag with an update_brief fix; while the
// proposal is pending the flag stays open instead of conceding at turn end.
export function gateFixProposed(storyId: string, resolves: string): void {
	const attempt = attempts.get(storyId);
	if (attempt === undefined) return;
	const flag = currentRound(attempt)?.flags.find(
		(each) =>
			each.title === resolves &&
			(each.status === "open" || each.status === "contested"),
	);
	if (flag === undefined || attempt.pendingFixes.has(resolves)) return;
	attempt.pendingFixes.add(resolves);
	broadcast();
}

// A rejected fix: the rejection resumes the session for a re-proposal; until
// one arrives the flag renders contested so the round never idles.
export function gateFixRejected(storyId: string, resolves: string): void {
	const attempt = attempts.get(storyId);
	if (attempt === undefined) return;
	if (!attempt.pendingFixes.has(resolves)) return;
	attempt.pendingFixes.delete(resolves);
	const flag = currentRound(attempt)?.flags.find(
		(each) => each.title === resolves,
	);
	if (flag !== undefined && flag.status === "open") flag.status = "contested";
	broadcast();
	void evaluate(attempt).catch((error) => logAndAbort(attempt, error));
}

const SINGLE_LINE = /\s*\n\s*/g;

// User resolution of a contested flag: accept files it as an open question
// (blocking the gate until the brief resolves it), dismiss records the
// override reason. Dismissal never delegates: this is RPC-only.
export async function resolveGateFlag(input: {
	storyId: string;
	flag: string;
	resolution: GateFlagResolution;
}): Promise<void> {
	const attempt = attempts.get(input.storyId);
	const flag = attempt
		? currentRound(attempt)?.flags.find((each) => each.title === input.flag)
		: undefined;
	if (attempt === undefined || flag === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no gate flag "${input.flag}" for story ${input.storyId}`,
		});
	}
	if (flag.status !== "contested") {
		throw new ApiError("FLAG_NOT_CONTESTED", {
			status: 409,
			message: `flag "${input.flag}" is ${flag.status}, not contested`,
		});
	}
	if (input.resolution.type === "dismiss") {
		flag.status = "dismissed";
		attempt.overrides.push(`${flag.title}: ${input.resolution.reason}`);
		broadcast();
		void evaluate(attempt).catch((error) => logAndAbort(attempt, error));
		return;
	}
	await enqueueWrite(async () => {
		const story = await readFresh(input.storyId);
		await writeStory({
			path: story.path,
			frontmatter: story.frontmatter,
			body: appendOpenQuestion(
				story.body,
				`${flag.title}: ${flag.detail.replace(SINGLE_LINE, " ")}`,
			),
		});
	});
	flag.status = "accepted";
	broadcast();
	void evaluate(attempt).catch((error) => logAndAbort(attempt, error));
}

function onClosed({ sessionId }: { sessionId?: string; stale: boolean }): void {
	if (sessionId === undefined) return;
	for (const attempt of attempts.values()) {
		if (attempt.refineSessionId !== sessionId) continue;
		if (attempt.pendingFlags) {
			attempt.pendingFlags = false;
			void routeFlags(attempt).catch(logError);
			continue;
		}
		if (attempt.phase !== "refine" && attempt.phase !== "review") continue;
		concedeOpenFlags(attempt);
		// direct assign: one broadcast for the phase flip and the flag change together
		if (attempt.phase === "refine") attempt.phase = "review";
		broadcast();
		void evaluate(attempt).catch((error) => logAndAbort(attempt, error));
	}
}

export default defineService({
	name: "gate",
	start: (ctx) => {
		log = ctx.log;
		handle = ctx.ws.channel(gateChannel, {
			onSubscribe: (conn) => {
				conn.send("snapshot", snapshot());
			},
		});
		onSessionClosed(onClosed);
		return () => {
			handle = undefined;
			log = undefined;
			attempts.clear();
		};
	},
});
