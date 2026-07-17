import { basename, dirname, sep } from "node:path";
import { watch } from "chokidar";
import type { Board, Epic, Notice, ShapingThread, Story } from "./schema.ts";
import {
	addToIndex,
	boardRoot,
	classify,
	duplicateEpicMessage,
	duplicateStoryMessage,
	EPIC_DIR_RE,
	epicFilePath,
	type IdIndex,
	invalidFrom,
	isENOENT,
	readEpicFile,
	readShapingFile,
	readStoryFile,
	removeFromIndex,
	scanBoard,
	storyOrdinal,
} from "./store.ts";
import { canTransition } from "./transitions.ts";

export type { Notice } from "./schema.ts";

export interface WatchCallbacks {
	// The board changed; rebuild and rebroadcast a snapshot.
	onChange(): void;
	// A reason a snapshot cannot carry (toast).
	onNotice(notice: Notice): void;
}

export interface BoardWatcher {
	snapshot(): Board;
	close(): Promise<void>;
}

// The watched root is `.helm/board/` (not `epics/`) so creating `epics/`
// later is still observed; callers ensure it exists (ensureBoard). The rest
// of `.helm/` (agents/, knowledge/, templates/) is outside the watch.
export async function watchBoard(
	repoPath: string,
	callbacks: WatchCallbacks,
): Promise<BoardWatcher> {
	const root = boardRoot(repoPath);
	const epics = new Map<string, Epic>();
	const stories = new Map<string, Story>();
	const shaping = new Map<string, ShapingThread>();
	const invalid = new Map<string, string>();
	const epicDirIds: IdIndex = new Map();
	const storyIds: IdIndex = new Map();
	let started = false;
	let changed = false;

	const setEpic = (path: string, epic: Epic): void => {
		if (epics.get(path)?.raw === epic.raw) return;
		epics.set(path, epic);
		changed = true;
	};
	const deleteEpic = (path: string): void => {
		if (epics.delete(path)) changed = true;
	};
	const setStory = (path: string, story: Story): void => {
		if (stories.get(path)?.raw === story.raw) return;
		stories.set(path, story);
		changed = true;
	};
	const deleteStory = (path: string): void => {
		if (stories.delete(path)) changed = true;
	};
	const setShaping = (path: string, thread: ShapingThread): void => {
		if (shaping.get(path)?.raw === thread.raw) return;
		shaping.set(path, thread);
		changed = true;
	};
	const deleteShaping = (path: string): void => {
		if (shaping.delete(path)) changed = true;
	};
	const markInvalid = (path: string, message: string): void => {
		if (invalid.get(path) === message) return;
		invalid.set(path, message);
		changed = true;
	};
	const clearInvalid = (path: string): void => {
		if (invalid.delete(path)) changed = true;
	};

	const readEpic = async (path: string): Promise<void> => {
		const epicId = EPIC_DIR_RE.exec(basename(dirname(path)))?.[1];
		if (epicId !== undefined && (epicDirIds.get(epicId)?.size ?? 0) > 1) {
			deleteEpic(path);
			return;
		}
		try {
			setEpic(path, await readEpicFile(path));
			clearInvalid(path);
		} catch (error) {
			deleteEpic(path);
			if (isENOENT(error)) clearInvalid(path);
			else markInvalid(path, invalidFrom(path, error).message);
		}
	};

	const readStory = async (path: string, epicId: string): Promise<void> => {
		const ordinal = storyOrdinal(path);
		if (ordinal === undefined) return;
		if ((storyIds.get(`${epicId}-${ordinal}`)?.size ?? 0) > 1) {
			deleteStory(path);
			return;
		}
		try {
			const story = await readStoryFile(path, epicId);
			const previous = stories.get(path);
			if (
				previous !== undefined &&
				previous.frontmatter.status !== story.frontmatter.status
			) {
				const from = previous.frontmatter.status;
				const to = story.frontmatter.status;
				const check = canTransition(from, to, story.brief);
				if (!check.ok) {
					callbacks.onNotice({
						kind: "illegal-transition",
						message: `Illegal hand edit: ${check.reason}`,
					});
				}
			}
			setStory(path, story);
			clearInvalid(path);
		} catch (error) {
			deleteStory(path);
			if (isENOENT(error)) clearInvalid(path);
			else markInvalid(path, invalidFrom(path, error).message);
		}
	};

	const readShaping = async (path: string): Promise<void> => {
		try {
			setShaping(path, await readShapingFile(path));
			clearInvalid(path);
		} catch (error) {
			deleteShaping(path);
			if (isENOENT(error)) clearInvalid(path);
			else markInvalid(path, invalidFrom(path, error).message);
		}
	};

	// Re-derive every holder of an id after its membership changed: duplicates
	// are all invalidated, a lone survivor is re-read and rehabilitated.
	const refreshEpicId = async (epicId: string): Promise<void> => {
		const dirs = [...(epicDirIds.get(epicId) ?? [])];
		if (dirs.length > 1) {
			for (const dir of dirs) {
				deleteEpic(epicFilePath(dir));
				markInvalid(dir, duplicateEpicMessage(epicId));
			}
			return;
		}
		const survivor = dirs[0];
		if (survivor !== undefined) {
			clearInvalid(survivor);
			await readEpic(epicFilePath(survivor));
		}
	};

	const refreshStoryId = async (storyId: string): Promise<void> => {
		const paths = [...(storyIds.get(storyId) ?? [])];
		if (paths.length > 1) {
			for (const path of paths) {
				deleteStory(path);
				markInvalid(path, duplicateStoryMessage(storyId));
			}
			return;
		}
		const survivor = paths[0];
		if (survivor !== undefined) {
			clearInvalid(survivor);
			const epicId = storyId.split("-")[0];
			if (epicId !== undefined) await readStory(survivor, epicId);
		}
	};

	const handleFile = async (path: string): Promise<void> => {
		const c = classify(root, path, "file");
		if (c.type === "ignored") return;
		if (c.type === "invalid") {
			markInvalid(path, c.message);
			return;
		}
		if (c.type === "shaping") {
			await readShaping(path);
			return;
		}
		if (c.type === "epic") {
			await readEpic(path);
			return;
		}
		if (c.type === "story") {
			const ordinal = storyOrdinal(path);
			if (ordinal === undefined) return;
			const storyId = `${c.epicId}-${ordinal}`;
			addToIndex(storyIds, storyId, path);
			if ((storyIds.get(storyId)?.size ?? 0) > 1) await refreshStoryId(storyId);
			else await readStory(path, c.epicId);
		}
	};

	const handleAddDir = async (path: string): Promise<void> => {
		const c = classify(root, path, "dir");
		if (c.type === "invalid") {
			markInvalid(path, c.message);
			return;
		}
		if (c.type === "epicDir") {
			addToIndex(epicDirIds, c.epicId, path);
			await refreshEpicId(c.epicId);
		}
	};

	const handleUnlink = async (path: string): Promise<void> => {
		clearInvalid(path);
		if (shaping.has(path)) {
			deleteShaping(path);
			return;
		}
		const story = stories.get(path);
		if (story !== undefined) {
			removeFromIndex(storyIds, story.id, path);
			deleteStory(path);
			await refreshStoryId(story.id);
			return;
		}
		// A duplicate-invalidated story is not in the map but still indexed.
		const epicId = EPIC_DIR_RE.exec(basename(dirname(path)))?.[1];
		const ordinal = storyOrdinal(path);
		if (epicId !== undefined && ordinal !== undefined) {
			const storyId = `${epicId}-${ordinal}`;
			if (storyIds.get(storyId)?.has(path)) {
				removeFromIndex(storyIds, storyId, path);
				await refreshStoryId(storyId);
				return;
			}
		}
		deleteEpic(path);
	};

	const handleUnlinkDir = async (dirPath: string): Promise<void> => {
		const prefix = dirPath + sep;
		clearInvalid(dirPath);
		for (const path of [...invalid.keys()]) {
			if (path.startsWith(prefix)) clearInvalid(path);
		}
		for (const path of [...epics.keys()]) {
			if (path.startsWith(prefix)) deleteEpic(path);
		}
		for (const path of [...shaping.keys()]) {
			if (path.startsWith(prefix)) deleteShaping(path);
		}
		const affectedStoryIds = new Set<string>();
		for (const [storyId, paths] of storyIds) {
			for (const path of [...paths]) {
				if (!path.startsWith(prefix)) continue;
				removeFromIndex(storyIds, storyId, path);
				deleteStory(path);
				clearInvalid(path);
				affectedStoryIds.add(storyId);
			}
		}
		const epicId = EPIC_DIR_RE.exec(basename(dirPath))?.[1];
		if (epicId !== undefined && epicDirIds.get(epicId)?.has(dirPath)) {
			removeFromIndex(epicDirIds, epicId, dirPath);
			await refreshEpicId(epicId);
		}
		for (const storyId of affectedStoryIds) await refreshStoryId(storyId);
	};

	let queue: Promise<void> = Promise.resolve();
	const enqueue = (task: () => Promise<void> | void): void => {
		queue = queue.then(async () => {
			changed = false;
			try {
				await task();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (started) callbacks.onNotice({ kind: "watch-error", message });
			}
			if (changed && started) callbacks.onChange();
		});
	};

	const watcher = watch(root, {
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
	});
	watcher.on("add", (path) => enqueue(() => handleFile(path)));
	watcher.on("change", (path) => enqueue(() => handleFile(path)));
	watcher.on("unlink", (path) => enqueue(() => handleUnlink(path)));
	watcher.on("addDir", (path) => enqueue(() => handleAddDir(path)));
	watcher.on("unlinkDir", (path) => enqueue(() => handleUnlinkDir(path)));
	watcher.on("error", (error) => {
		const message = error instanceof Error ? error.message : String(error);
		if (started) callbacks.onNotice({ kind: "watch-error", message });
	});

	await new Promise<void>((resolve, reject) => {
		watcher.once("ready", () => resolve());
		watcher.once("error", (error) =>
			reject(error instanceof Error ? error : new Error(String(error))),
		);
	});

	// Seed through the queue so filesystem events that arrive during the scan
	// serialize behind it instead of racing the map writes. A failed initial
	// scan (e.g. EACCES) rejects `watchBoard` rather than serving an empty
	// board; close chokidar before rejecting.
	let seedError: unknown;
	queue = queue.then(async () => {
		try {
			const scan = await scanBoard(repoPath);
			for (const [path, epic] of scan.epics) epics.set(path, epic);
			for (const [path, story] of scan.stories) stories.set(path, story);
			for (const [path, thread] of scan.shaping) shaping.set(path, thread);
			for (const [path, message] of scan.invalid) invalid.set(path, message);
			for (const [id, paths] of scan.epicDirIds) epicDirIds.set(id, paths);
			for (const [id, paths] of scan.storyIds) storyIds.set(id, paths);
		} catch (error) {
			seedError = error;
		}
	});
	await queue;
	if (seedError !== undefined) {
		await watcher.close();
		throw seedError;
	}
	started = true;

	const byPath = <T extends { path: string }>(a: T, b: T): number =>
		a.path.localeCompare(b.path);

	return {
		snapshot: () => ({
			epics: [...epics.values()].sort(byPath),
			stories: [...stories.values()].sort(byPath),
			shaping: [...shaping.values()].sort(byPath),
			invalid: [...invalid.entries()]
				.map(([path, message]) => ({ path, message }))
				.sort(byPath),
		}),
		close: async () => {
			await watcher.close();
			await queue;
		},
	};
}
