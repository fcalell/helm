import { defineChannel } from "@fcalell/plugin-node/ws";
import { boardSchema, noticeSchema } from "../board/schema.ts";
import {
	sessionClosedSchema,
	sessionWireEventSchema,
} from "../sessions/events.ts";

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
