import { z } from "@fcalell/plugin-api/schema";
import {
	type Board,
	boardSchema,
	type Notice,
	noticeSchema,
} from "../../src/board/schema.ts";
import type { ProposalSnapshot } from "../../src/server/mcp/schemas.ts";
import { proposalSnapshotSchema } from "../../src/server/mcp/schemas.ts";
import {
	type SessionClosed,
	sessionClosedSchema,
} from "../../src/sessions/events.ts";
import type {
	GateFlag,
	GatePhase,
	GateSnapshot,
} from "../../src/shared/gate.ts";
import { gateSnapshotSchema } from "../../src/shared/gate.ts";
import type { MeterSnapshot } from "../../src/shared/meter.ts";
import { meterSnapshotSchema } from "../../src/shared/meter.ts";

// The driver's only eyes: gate phase, flags, pending proposals, session
// liveness and the meter have no worker route, so all five channels are read
// from the socket.
const CHANNELS = ["board", "session", "proposal", "gate", "meter"];

const frameSchema = z.object({
	t: z.literal("msg"),
	ch: z.string(),
	type: z.string(),
	payload: z.unknown(),
});

const POLL_MS = 50;
const DEFAULT_TIMEOUT_MS = 45_000;

export type GateFlagStatus = GateFlag["status"];

function flagKey(storyId: string, title: string): string {
	return `${storyId} :: ${title}`;
}

export interface Observer {
	board(): Board | undefined;
	gate(): GateSnapshot | undefined;
	proposals(): ProposalSnapshot | undefined;
	meter(): MeterSnapshot | undefined;
	notices(): readonly Notice[];
	closed(): readonly SessionClosed[];
	// Every phase the gate has been in for this story, in order, deduplicated.
	phases(storyId: string): readonly GatePhase[];
	// Every status a flag has been seen in. A settled flag can vanish with its
	// attempt before the next poll, so the history is what an assertion reads.
	flagStatuses(storyId: string, title: string): ReadonlySet<GateFlagStatus>;
	maxRounds(storyId: string): number;
	waitFor<T>(
		what: string,
		probe: () => T | undefined,
		timeoutMs?: number,
	): Promise<T>;
	close(): void;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// `invalid` is owned by the episode, not by this socket: a restart swaps the
// observer, and an invalid file that heals between two board frames leaves no
// other trace because `board` is last-write-wins.
export async function observe(
	base: string,
	invalid: Map<string, string>,
): Promise<Observer> {
	const socket = new WebSocket(`${base.replace("http", "ws")}/ws`);
	let board: Board | undefined;
	let gate: GateSnapshot | undefined;
	let proposals: ProposalSnapshot | undefined;
	let meter: MeterSnapshot | undefined;
	const notices: Notice[] = [];
	const closed: SessionClosed[] = [];
	const phases = new Map<string, GatePhase[]>();
	const maxRounds = new Map<string, number>();
	const flagStatuses = new Map<string, Set<GateFlagStatus>>();

	socket.onmessage = (event) => {
		if (typeof event.data !== "string") return;
		const frame = frameSchema.safeParse(JSON.parse(event.data));
		if (!frame.success) return;
		const { ch, type, payload } = frame.data;
		if (ch === "board" && type === "snapshot") {
			board = boardSchema.parse(payload);
			for (const file of board.invalid) invalid.set(file.path, file.message);
		} else if (ch === "board" && type === "notice") {
			notices.push(noticeSchema.parse(payload));
		} else if (ch === "gate" && type === "snapshot") {
			gate = gateSnapshotSchema.parse(payload);
			for (const attempt of gate.attempts) {
				const seen = phases.get(attempt.storyId) ?? [];
				if (seen[seen.length - 1] !== attempt.phase) seen.push(attempt.phase);
				phases.set(attempt.storyId, seen);
				maxRounds.set(
					attempt.storyId,
					Math.max(maxRounds.get(attempt.storyId) ?? 0, attempt.rounds.length),
				);
				for (const flag of attempt.rounds.flatMap((round) => round.flags)) {
					const key = flagKey(attempt.storyId, flag.title);
					const seenStatuses = flagStatuses.get(key) ?? new Set();
					seenStatuses.add(flag.status);
					flagStatuses.set(key, seenStatuses);
				}
			}
		} else if (ch === "proposal" && type === "snapshot") {
			proposals = proposalSnapshotSchema.parse(payload);
		} else if (ch === "meter" && type === "snapshot") {
			meter = meterSnapshotSchema.parse(payload);
		} else if (ch === "session" && type === "closed") {
			closed.push(sessionClosedSchema.parse(payload));
		}
	};

	await new Promise<void>((resolve, reject) => {
		socket.onopen = () => resolve();
		socket.onerror = () => reject(new Error(`ws never opened on ${base}`));
	});
	for (const ch of CHANNELS) socket.send(JSON.stringify({ t: "sub", ch }));

	return {
		board: () => board,
		gate: () => gate,
		proposals: () => proposals,
		meter: () => meter,
		notices: () => notices,
		closed: () => closed,
		phases: (storyId) => phases.get(storyId) ?? [],
		flagStatuses: (storyId, title) =>
			flagStatuses.get(flagKey(storyId, title)) ?? new Set(),
		maxRounds: (storyId) => maxRounds.get(storyId) ?? 0,
		async waitFor(what, probe, timeoutMs = DEFAULT_TIMEOUT_MS) {
			const deadline = Date.now() + timeoutMs;
			for (;;) {
				const found = probe();
				if (found !== undefined) return found;
				if (Date.now() > deadline) {
					throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
				}
				await sleep(POLL_MS);
			}
		},
		close: () => socket.close(),
	};
}
