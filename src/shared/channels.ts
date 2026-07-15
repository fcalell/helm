import { defineChannel } from "@fcalell/plugin-node/ws";
import { boardEventSchema, boardSchema } from "../board/schema.ts";

// The one realtime channel: the server sends a full board snapshot on every
// (re)subscribe, then relays watcher events verbatim. Mutations go over RPC,
// so the client declares no messages.
export const boardChannel = defineChannel("board", {
	server: {
		snapshot: boardSchema,
		event: boardEventSchema,
	},
	client: {},
});
