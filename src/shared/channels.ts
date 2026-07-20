import { defineChannel } from "@fcalell/plugin-node/ws";
import { boardSchema, noticeSchema } from "../board/schema.ts";
import { proposalSnapshotSchema } from "../server/mcp/schemas.ts";
import {
	sessionClosedSchema,
	sessionWireEventSchema,
} from "../sessions/events.ts";
import { gateSnapshotSchema } from "./gate.ts";
import { meterSnapshotSchema } from "./meter.ts";

// The board channel: the server sends a full board snapshot on every
// (re)subscribe and on every change, plus `notice` toasts for reasons a
// snapshot cannot carry. Mutations go over RPC, so the client declares no
// messages.
export const boardChannel = defineChannel("board", {
	server: {
		snapshot: boardSchema,
		notice: noticeSchema,
	},
	client: {},
});

// The session channel: every CLI stream event of every live session,
// broadcast as it arrives, plus one `closed` per process exit. Clients
// filter by sessionId/runId; mutations (spawn, message, kill) go over RPC.
export const sessionChannel = defineChannel("session", {
	server: {
		event: sessionWireEventSchema,
		closed: sessionClosedSchema,
	},
	client: {},
});

// The proposal channel: pending proposals and questions, sent as a full
// snapshot on every (re)subscribe and on every change (the board-channel
// pattern; the pending set is small and a missed frame is irrelevant).
// Resolutions go over RPC.
export const proposalChannel = defineChannel("proposal", {
	server: { snapshot: proposalSnapshotSchema },
	client: {},
});

// The gate channel: every active ready-gate attempt (story id, phase, rounds),
// sent as a full snapshot on every (re)subscribe and on every change, so a
// late subscriber replays the current gate state. Flag resolutions go over
// RPC.
export const gateChannel = defineChannel("gate", {
	server: { snapshot: gateSnapshotSchema },
	client: {},
});

// The meter channel: dispatcher queue occupancy plus the rate-limit meter,
// sent as a full snapshot on every (re)subscribe and on every queue or meter
// change (100ms debounce, the board pattern). Display only; `run.dequeue`
// travels over RPC.
export const meterChannel = defineChannel("meter", {
	server: { snapshot: meterSnapshotSchema },
	client: {},
});
