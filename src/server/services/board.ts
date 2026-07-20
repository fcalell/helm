import { type ChannelHandle, defineService } from "@fcalell/plugin-node/server";
import { createEpic, slugify } from "../../board/create.ts";
import { nextEpicOrdinal } from "../../board/ordinals.ts";
import type { Board, Notice } from "../../board/schema.ts";
import { ensureBoard } from "../../board/store.ts";
import { type BoardWatcher, watchBoard } from "../../board/watcher.ts";
import { boardChannel } from "../../shared/channels.ts";
import { loadManagedRepo, type ManagedRepo } from "../config.ts";
import { enqueueWrite } from "../write-queue.ts";

// Collapse a burst of filesystem events into one broadcast.
const BROADCAST_DEBOUNCE_MS = 100;

let watcher: BoardWatcher | null = null;
let repo: ManagedRepo | null = null;
let handle: ChannelHandle<(typeof boardChannel)["server"]> | undefined;

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

// Toast path for reasons a snapshot cannot carry; the watcher's onNotice and
// the runs service's queue skips both land here.
export function broadcastNotice(notice: Notice): void {
	handle?.broadcast("notice", notice);
}

// The `n` entry: mint the next epic ordinal and write `<NNN>-<slug>/epic.md`
// with the title and rough goal; the define chat completes the body later.
export async function createEpicEntry(input: {
	title: string;
	goal: string;
}): Promise<{ epicId: string }> {
	const repoPath = managedRepo().path;
	return enqueueWrite(async () => {
		const ordinal = await nextEpicOrdinal(repoPath);
		const { epicId } = await createEpic(repoPath, ordinal, {
			slug: slugify(input.title),
			title: input.title,
			goal: input.goal,
		});
		return { epicId };
	});
}

export default defineService({
	name: "board",
	start: async (ctx) => {
		repo = await loadManagedRepo();
		await ensureBoard(repo.path);

		let broadcastTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleBroadcast = (): void => {
			if (broadcastTimer !== undefined) clearTimeout(broadcastTimer);
			broadcastTimer = setTimeout(() => {
				broadcastTimer = undefined;
				handle?.broadcast("snapshot", boardSnapshot());
			}, BROADCAST_DEBOUNCE_MS);
		};

		watcher = await watchBoard(repo.path, {
			onChange: scheduleBroadcast,
			onNotice: broadcastNotice,
		});
		handle = ctx.ws.channel(boardChannel, {
			onSubscribe: (conn) => {
				conn.send("snapshot", boardSnapshot());
			},
		});
		ctx.log.info(`board: watching ${repo.path}`);
		return async () => {
			if (broadcastTimer !== undefined) clearTimeout(broadcastTimer);
			await watcher?.close();
			watcher = null;
			repo = null;
			handle = undefined;
		};
	},
});
