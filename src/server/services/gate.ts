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
	clearGateRounds,
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
import { boardSnapshot, broadcastNotice } from "./board.ts";
import { messageSession, onSessionClosed, runFreshTurn } from "./sessions.ts";

// One ready-gate attempt per story, in memory only (like pending proposals):
// a restart drops it and the next move-to-ready starts fresh. The `gate`
// frontmatter block is the durable record every attempt appends to.
interface Attempt {
	storyId: string;
	phase: GatePhase;
	// Hash of the brief body the current round's adversary read; a verdict
	// landing after an edit fails this check and is discarded.
	briefHash: string;
	rounds: GateRound[];
	// The recorded round number of `rounds[i]`, taken on that round's first
	// write and reused by every later one; sparse until then.
	durableRounds: number[];
	overrides: string[];
	adversarySessionId?: string;
	refineSessionId?: string;
	// Flags answered by a pending fix proposal; never concede these at turn end.
	pendingFixes: Set<string>;
	// The flags prompt found the story busy and is waiting to be routed;
	// `routeFlags` is the only writer.
	pendingFlags?: boolean;
	// The next round routes to a fresh refine session seeded from the story
	// file instead of resuming `sessions.refine`. Set on a retry of an
	// exhausted attempt, cleared once the fresh turn spawns.
	reseedRefine?: boolean;
	// Serial chain of park retries: every close appends one link while the
	// round is parked, so a retry that re-parks is healed by the next close.
	flagRetries?: Promise<void>;
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

// The one funnel every gate state change passes through: the live snapshot to
// the UI, the round record to disk. Both audiences see the same state, so the
// changed attempt is the subject of both.
function broadcast(attempt: Attempt): void {
	handle?.broadcast("snapshot", snapshot());
	persistGate(attempt);
}

function setPhase(attempt: Attempt, phase: GatePhase): void {
	attempt.phase = phase;
	broadcast(attempt);
}

function abort(attempt: Attempt): void {
	if (attempts.get(attempt.storyId) !== attempt) return;
	attempts.delete(attempt.storyId);
	broadcast(attempt);
}

// Drops the attempt a story holds, so a clear of its record is not restored by
// the attempt's next broadcast. Called by every write that moves a story out
// of `refining` outside this module.
export function dropGateAttempt(storyId: string): void {
	const attempt = attempts.get(storyId);
	if (attempt !== undefined) abort(attempt);
}

function currentRound(attempt: Attempt): GateRound | undefined {
	return attempt.rounds[attempt.rounds.length - 1];
}

function logError(error: unknown): void {
	log?.error(`gate: ${String(error)}`);
}

// Every gate abort routes here: a log line for the diagnostic, a toast so the
// drop never vanishes from the UI, then the state removal. `message` names the
// specific cause at the call site.
function abortWith(attempt: Attempt, message: string, error?: unknown): void {
	if (error !== undefined) logError(error);
	else logError(`aborted ${attempt.storyId}: ${message}`);
	broadcastNotice({ kind: "gate-aborted", message });
	abort(attempt);
}

function logAndAbort(attempt: Attempt, error: unknown): void {
	abortWith(attempt, `ready gate for ${attempt.storyId} failed`, error);
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

// Appends this attempt's rounds to the story's record. Synchronous by
// contract: it *schedules* the write and never awaits it, so calling it from
// inside a queued task cannot deadlock the shared write queue, and a failure
// cannot reach `evaluate`'s callers or abort the attempt it exists to record.
// Every guard is re-checked inside the task, which runs an unknown amount of
// queued work later.
function persistGate(attempt: Attempt): void {
	if (attempt.rounds.length === 0) return;
	void enqueueWrite(async () => {
		const story = await readFresh(attempt.storyId).catch(() => undefined);
		if (story === undefined) return;
		if (story.frontmatter.status !== "refining") return;
		if (attempt.rounds.length === 0) return;
		const current = story.frontmatter.gate;
		const rounds = [...(current?.rounds ?? [])];
		for (const [index, round] of attempt.rounds.entries()) {
			let n = attempt.durableRounds[index];
			if (n === undefined) {
				n = rounds.length + 1;
				attempt.durableRounds[index] = n;
			}
			const entry = {
				n,
				flags: round.flags.map((flag) => ({
					title: flag.title,
					status: flag.status,
				})),
			};
			const at = rounds.findIndex((each) => each.n === n);
			if (at === -1) rounds.push(entry);
			else rounds[at] = entry;
		}
		const gate: Gate = { ...(current ?? { overrides: [] }), rounds };
		if (JSON.stringify(gate) === JSON.stringify(current)) return;
		await writeStory({
			path: story.path,
			frontmatter: { ...story.frontmatter, gate },
			body: story.body,
		});
	}).catch(logError);
}

function illegal(from: Status, reason: string) {
	return new ApiError("ILLEGAL_TRANSITION", {
		status: 409,
		message: reason,
		data: { from, to: "ready", reason },
	});
}

export async function requestReady(
	id: string,
): Promise<
	{ gating: false } | { gating: true; phase: Exclude<GatePhase, "exhausted"> }
> {
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
			dropGateAttempt(id);
			await writeStory({
				path: current.path,
				frontmatter: {
					...current.frontmatter,
					status: "ready",
					gate: clearGateRounds(current.frontmatter.gate),
				},
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
			if (existing.phase === "exhausted") {
				existing.reseedRefine = true;
				enqueueRound(existing);
				return { gating: true, phase: "queued" };
			}
			return { gating: true, phase: existing.phase };
		}
		const attempt: Attempt = {
			storyId: id,
			phase: "queued",
			briefHash: briefHash(current.body),
			rounds: [],
			durableRounds: [],
			overrides: [],
			pendingFixes: new Set(),
		};
		attempts.set(id, attempt);
		enqueueRound(attempt);
		return { gating: true, phase: "queued" };
	});
}

function enqueueRound(attempt: Attempt): void {
	setPhase(attempt, "queued");
	void dispatch(() => runRound(attempt), {
		kind: "adversary",
		storyId: attempt.storyId,
	}).catch((error) => {
		abortWith(
			attempt,
			`ready gate for ${attempt.storyId} could not run the adversary`,
			error,
		);
	});
}

async function runRound(attempt: Attempt): Promise<void> {
	if (attempts.get(attempt.storyId) !== attempt) return;
	const story = await readFresh(attempt.storyId).catch(() => undefined);
	if (story === undefined || story.frontmatter.status !== "refining") {
		logError(`story ${attempt.storyId} left refining; attempt aborted`);
		abort(attempt);
		return;
	}
	attempt.briefHash = briefHash(story.body);
	attempt.rounds.push({ n: attempt.rounds.length + 1, flags: [] });
	setPhase(attempt, "adversary");
	const run = await runFreshTurn({
		kind: "adversary",
		prompt: adversaryPrompt(story.body, attempt.overrides),
		attach: { type: "story", id: attempt.storyId },
	});
	attempt.adversarySessionId = run.sessionId;
	await run.done;
	if (attempts.get(attempt.storyId) !== attempt) return;
	const after = await readFresh(attempt.storyId).catch(() => undefined);
	if (after === undefined) {
		logError(
			`story ${attempt.storyId} unreadable after a round; attempt aborted`,
		);
		abort(attempt);
		return;
	}
	if (briefHash(after.body) !== attempt.briefHash) {
		// The brief moved mid-flight: this round's verdict read stale text and
		// is discarded, and a fresh round attacks the new brief. The attempt
		// (rounds, overrides, pending fixes) survives.
		enqueueRound(attempt);
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
		concedeToReview(attempt);
		return;
	}
	if (attempt.reseedRefine === true) {
		await reseedFlags(attempt, round, refineId);
		return;
	}
	attempt.refineSessionId = refineId;
	setPhase(attempt, "refine");
	try {
		const { sessionId } = await messageSession({
			sessionId: refineId,
			prompt: gateFlagsPrompt(round.flags, []),
		});
		attempt.pendingFlags = false;
		// A stale resume reseeds under a fresh id.
		attempt.refineSessionId = sessionId;
	} catch (error) {
		if (error instanceof ApiError && error.code === "SESSION_BUSY") {
			attempt.pendingFlags = true;
			return;
		}
		concedeToReview(attempt, error);
	}
}

// The marked route: a retry of an exhausted attempt runs its round in a fresh
// refine session seeded from the story file, carrying the flags and the
// attempt's override register.
async function reseedFlags(
	attempt: Attempt,
	round: GateRound,
	refineId: string,
): Promise<void> {
	// Unset across the whole spawn, so no close reaches the id-matched settle
	// while the reseeded turn's own continuation owns its end.
	attempt.refineSessionId = undefined;
	setPhase(attempt, "refine");
	try {
		const { sessionId, done } = await runFreshTurn({
			kind: "refine",
			prompt: gateFlagsPrompt(round.flags, attempt.overrides),
			attach: { type: "story", id: attempt.storyId },
		});
		attempt.pendingFlags = false;
		attempt.reseedRefine = false;
		// The turn's end is its end whichever way `done` settles: a closed
		// listener that threw rejects it, and the round still has to leave
		// `refine`. The id lands after the settle, so `onClosed` cannot repeat it.
		void done
			.catch(logError)
			.then(() => {
				settleRefineTurn(attempt, round);
				attempt.refineSessionId = sessionId;
			})
			.catch(logError);
	} catch (error) {
		if (error instanceof ApiError && error.code === "SESSION_BUSY") {
			attempt.pendingFlags = true;
			return;
		}
		attempt.refineSessionId = refineId;
		concedeToReview(attempt, error);
	}
}

// A flags route that reached no refine turn: the round concedes so it never
// idles, and the attempt waits for the user in review.
function concedeToReview(attempt: Attempt, error?: unknown): void {
	attempt.pendingFlags = false;
	if (error !== undefined) logError(error);
	concedeOpenFlags(attempt);
	setPhase(attempt, "review");
}

// One link of the park's retry chain. The park outlives any single session
// id, so the link re-reads the story rather than trusting the close that
// scheduled it.
function retryFlags(attempt: Attempt): Promise<void> {
	if (attempts.get(attempt.storyId) !== attempt) return Promise.resolve();
	if (attempt.pendingFlags !== true) return Promise.resolve();
	return routeFlags(attempt);
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
		logError(`story ${attempt.storyId} unreadable; attempt aborted`);
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
				rounds: [],
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
		abortWith(
			attempt,
			`ready gate for ${attempt.storyId} could not record the pass`,
			error,
		);
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
	broadcast(attempt);
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
	broadcast(attempt);
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
			broadcast(attempt);
		}
	}
	void evaluate(attempt).catch((error) => logAndAbort(attempt, error));
}

// The refine session answered a flag with an update_brief fix; while the
// proposal is pending the flag stays open instead of conceding at turn end.
// Returns an error message for the tool result, or undefined on success.
export function gateFixProposed(
	storyId: string,
	resolves: string,
): string | undefined {
	const attempt = attempts.get(storyId);
	if (attempt === undefined) return "no gate round is open for this story";
	const unresolved = (currentRound(attempt)?.flags ?? []).filter(
		(each) => each.status === "open" || each.status === "contested",
	);
	const flag = unresolved.find((each) => each.title === resolves);
	if (flag === undefined) {
		if (unresolved.length === 0) {
			return "no unresolved flags in the current round; drop resolves";
		}
		return (
			`no unresolved flag titled "${resolves}"; unresolved flags: ` +
			unresolved.map((each) => `"${each.title}"`).join(", ")
		);
	}
	if (!attempt.pendingFixes.has(resolves)) {
		attempt.pendingFixes.add(resolves);
		broadcast(attempt);
	}
	return undefined;
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
	broadcast(attempt);
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
		broadcast(attempt);
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
	broadcast(attempt);
	void evaluate(attempt).catch((error) => logAndAbort(attempt, error));
}

// The end of the refine turn a round routed to. Every guard here is about the
// attempt rather than about which close arrived, so both the id-matched close
// and the reseed's continuation share them; the round is an argument, so a
// turn that outlived the round it was spawned for settles nothing.
function settleRefineTurn(
	attempt: Attempt,
	round: GateRound | undefined,
): void {
	if (attempts.get(attempt.storyId) !== attempt) return;
	if (attempt.pendingFlags === true) return;
	if (attempt.phase !== "refine" && attempt.phase !== "review") return;
	if (currentRound(attempt) !== round) return;
	concedeOpenFlags(attempt);
	// direct assign: one broadcast for the phase flip and the flag change together
	if (attempt.phase === "refine") attempt.phase = "review";
	broadcast(attempt);
	void evaluate(attempt).catch((error) => logAndAbort(attempt, error));
}

function onClosed({ sessionId }: { sessionId?: string; stale: boolean }): void {
	for (const attempt of attempts.values()) {
		// A parked round is waiting on whichever turn holds the story, not on
		// the id it was parked under, so every close feeds the chain.
		if (attempt.pendingFlags === true) {
			attempt.flagRetries = (attempt.flagRetries ?? Promise.resolve())
				.then(() => retryFlags(attempt))
				.catch(logError);
			continue;
		}
		if (sessionId === undefined) continue;
		if (attempt.refineSessionId !== sessionId) continue;
		settleRefineTurn(attempt, currentRound(attempt));
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
