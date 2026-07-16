import { defineChannel } from "@fcalell/plugin-node/ws";
import { boardSchema, noticeSchema } from "../board/schema.ts";

// The one realtime channel: the server sends a full board snapshot on every
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
