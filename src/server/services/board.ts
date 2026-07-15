import { defineService } from "@fcalell/plugin-node/server";
import type { Board } from "../../board/schema.ts";
import { ensureBoard } from "../../board/store.ts";
import { type BoardWatcher, watchBoard } from "../../board/watcher.ts";
import { boardChannel } from "../../shared/channels.ts";
import { loadManagedRepo, type ManagedRepo } from "../config.ts";

let watcher: BoardWatcher | null = null;
let repo: ManagedRepo | null = null;

// Module singleton: route handlers import these directly instead of
// receiving a context.
export function boardSnapshot(): Board {
	if (watcher === null) throw new Error("board service is not running");
	return watcher.snapshot();
}

export function managedRepo(): ManagedRepo {
	if (repo === null) throw new Error("board service is not running");
	return repo;
}

export default defineService({
	name: "board",
	start: async (ctx) => {
		repo = await loadManagedRepo();
		const handle = ctx.ws.channel(boardChannel, {
			onSubscribe: (conn) => {
				conn.send("snapshot", boardSnapshot());
			},
		});
		await ensureBoard(repo.path);
		watcher = await watchBoard(repo.path, (event) => {
			handle.broadcast("event", event);
		});
		ctx.log.info(`board: watching ${repo.path}`);
		return async () => {
			await watcher?.close();
			watcher = null;
			repo = null;
		};
	},
});
