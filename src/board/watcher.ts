import { join, relative, sep } from "node:path";
import { watch } from "chokidar";
import type {
	Board,
	BoardEvent,
	Epic,
	IllegalTransition,
	Story,
} from "./schema.ts";
import {
	EPIC_DIR_RE,
	invalidFrom,
	loadBoard,
	readEpicFile,
	readStoryFile,
	STORY_FILE_RE,
} from "./store.ts";
import { canTransition } from "./transitions.ts";

export type { BoardEvent, IllegalTransition } from "./schema.ts";

export interface BoardWatcher {
	snapshot(): Board;
	close(): Promise<void>;
}

// The watched root is `.helm/` (not `epics/`) so creating `epics/` later is
// still observed; callers ensure `.helm/` itself exists (ensureBoard).
export async function watchBoard(
	repoPath: string,
	onEvent: (event: BoardEvent) => void,
): Promise<BoardWatcher> {
	const root = join(repoPath, ".helm");
	const epics = new Map<string, Epic>();
	const stories = new Map<string, Story>();
	const invalid = new Map<string, string>();
	let started = false;

	const emit = (event: BoardEvent): void => {
		if (started) onEvent(event);
	};

	const markInvalid = (path: string, message: string): void => {
		if (invalid.get(path) === message) return;
		invalid.set(path, message);
		emit({ kind: "file-invalid", path, message });
	};

	const clearInvalid = (path: string): void => {
		if (invalid.delete(path)) emit({ kind: "invalid-cleared", path });
	};

	const handleEpicFile = async (path: string): Promise<void> => {
		try {
			const epic = await readEpicFile(path);
			const previous = epics.get(path);
			if (previous?.raw === epic.raw) return;
			epics.set(path, epic);
			clearInvalid(path);
			emit(
				previous === undefined
					? { kind: "epic-added", epic }
					: { kind: "epic-changed", epic },
			);
		} catch (error) {
			epics.delete(path);
			markInvalid(path, invalidFrom(path, error).message);
		}
	};

	const handleStoryFile = async (
		path: string,
		epicId: string,
	): Promise<void> => {
		try {
			const story = await readStoryFile(path, epicId);
			const previous = stories.get(path);
			if (previous?.raw === story.raw) return;
			stories.set(path, story);
			clearInvalid(path);
			if (previous === undefined) {
				emit({ kind: "story-added", story });
				return;
			}
			let illegalTransition: IllegalTransition | undefined;
			const from = previous.frontmatter.status;
			const to = story.frontmatter.status;
			if (from !== to) {
				const check = canTransition(from, to, story.brief);
				if (!check.ok) illegalTransition = { from, to, reason: check.reason };
			}
			emit({ kind: "story-changed", story, illegalTransition });
		} catch (error) {
			stories.delete(path);
			markInvalid(path, invalidFrom(path, error).message);
		}
	};

	const handleAddOrChange = async (path: string): Promise<void> => {
		if (!path.endsWith(".md")) return;
		const parts = relative(root, path).split(sep);
		if (parts[0] !== "epics") return;
		if (parts.length === 2) {
			markInvalid(
				path,
				"unexpected file: boards contain only epic directories",
			);
			return;
		}
		const epicDir = parts[1];
		const fileName = parts[2];
		if (parts.length !== 3 || epicDir === undefined || fileName === undefined) {
			return;
		}
		const epicId = EPIC_DIR_RE.exec(epicDir)?.[1];
		if (epicId === undefined) return;
		if (fileName === "epic.md") {
			await handleEpicFile(path);
			return;
		}
		if (!STORY_FILE_RE.test(fileName)) {
			markInvalid(path, "story files are named <NN>-<slug>.md");
			return;
		}
		await handleStoryFile(path, epicId);
	};

	const handleAddDir = (path: string): void => {
		const parts = relative(root, path).split(sep);
		if (
			parts.length === 2 &&
			parts[0] === "epics" &&
			parts[1] !== undefined &&
			!EPIC_DIR_RE.test(parts[1])
		) {
			markInvalid(path, "epic directories are named <NNN>-<slug>");
		}
	};

	const handleUnlink = (path: string): void => {
		clearInvalid(path);
		const story = stories.get(path);
		if (story !== undefined) {
			stories.delete(path);
			emit({ kind: "story-removed", path, id: story.id });
			return;
		}
		const epic = epics.get(path);
		if (epic !== undefined) {
			epics.delete(path);
			emit({ kind: "epic-removed", path, id: epic.id });
		}
	};

	const handleUnlinkDir = (dirPath: string): void => {
		const prefix = dirPath + sep;
		clearInvalid(dirPath);
		for (const path of [...invalid.keys()]) {
			if (path.startsWith(prefix)) clearInvalid(path);
		}
		for (const path of [...stories.keys()]) {
			if (path.startsWith(prefix)) handleUnlink(path);
		}
		for (const path of [...epics.keys()]) {
			if (path.startsWith(prefix)) handleUnlink(path);
		}
	};

	let queue: Promise<void> = Promise.resolve();
	const enqueue = (task: () => Promise<void> | void): void => {
		queue = queue.then(task).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			emit({ kind: "watch-error", message });
		});
	};

	const watcher = watch(root, {
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
	});
	watcher.on("add", (path) => enqueue(() => handleAddOrChange(path)));
	watcher.on("change", (path) => enqueue(() => handleAddOrChange(path)));
	watcher.on("unlink", (path) => enqueue(() => handleUnlink(path)));
	watcher.on("addDir", (path) => enqueue(() => handleAddDir(path)));
	watcher.on("unlinkDir", (path) => enqueue(() => handleUnlinkDir(path)));
	watcher.on("error", (error) => {
		const message = error instanceof Error ? error.message : String(error);
		emit({ kind: "watch-error", message });
	});

	await new Promise<void>((resolve, reject) => {
		watcher.once("ready", () => resolve());
		watcher.once("error", (error) =>
			reject(error instanceof Error ? error : new Error(String(error))),
		);
	});
	enqueue(async () => {
		const board = await loadBoard(repoPath);
		for (const epic of board.epics) epics.set(epic.path, epic);
		for (const story of board.stories) stories.set(story.path, story);
		for (const file of board.invalid) invalid.set(file.path, file.message);
	});
	await queue;
	started = true;

	const byPath = <T extends { path: string }>(a: T, b: T): number =>
		a.path.localeCompare(b.path);

	return {
		snapshot: () => ({
			epics: [...epics.values()].sort(byPath),
			stories: [...stories.values()].sort(byPath),
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
