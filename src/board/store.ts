import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { z } from "@fcalell/plugin-api/schema";
import { parse as parseYaml } from "yaml";
import {
	parseBrief,
	parseDecisions,
	serializeEpic,
	serializeShaping,
	serializeStory,
	splitFrontmatter,
} from "./markdown.ts";
import {
	type Board,
	type Epic,
	type EpicFrontmatter,
	epicFrontmatterSchema,
	type InvalidFile,
	type ShapingThread,
	type Story,
	shapingFrontmatterSchema,
	storyFrontmatterSchema,
} from "./schema.ts";

export const EPIC_DIR_RE = /^(\d{3})-([a-z0-9-]+)$/;
export const STORY_FILE_RE = /^(\d{2})-([a-z0-9-]+)\.md$/;
export const SHAPING_FILE_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

// One home for every classification message, so the loader and the watcher
// (both consumers of `classify`) cannot drift on wording.
export const INVALID_MESSAGES = {
	fileInEpicsRoot: "unexpected file: boards contain only epic directories",
	epicDirName: "epic directories are named <NNN>-<slug>",
	storyFileName: "story files are named <NN>-<slug>.md",
	shapingEntry: "shaping entries are <slug>.md threads",
} as const;

export function duplicateEpicMessage(epicId: string): string {
	return `duplicate epic number ${epicId}`;
}

export function duplicateStoryMessage(storyId: string): string {
	const [epicId, ordinal] = storyId.split("-");
	return `duplicate story number ${ordinal} in epic ${epicId}`;
}

export type {
	Board,
	Epic,
	InvalidFile,
	ShapingThread,
	Story,
} from "./schema.ts";

export class InvalidBoardFileError extends Error {
	readonly path: string;

	constructor(path: string, message: string) {
		super(message);
		this.name = "InvalidBoardFileError";
		this.path = path;
	}
}

export function isENOENT(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function invalidFrom(path: string, error: unknown): InvalidFile {
	if (error instanceof InvalidBoardFileError) {
		return { path, message: error.message };
	}
	return {
		path,
		message: error instanceof Error ? error.message : String(error),
	};
}

// What a single path under `.helm/board/` is. `kind` is the filesystem
// entry kind because the path alone cannot distinguish a directory named
// `01-foo.md/` from a story file. F4's duplicate-ordinal check sits in the
// scan layer above this (`scanBoard`, the watcher), which sees every path.
export type PathClass =
	| { type: "epicDir"; epicId: string }
	| { type: "epic"; epicId: string }
	| { type: "story"; epicId: string }
	| { type: "shaping" }
	| { type: "invalid"; message: string }
	| { type: "ignored" };

function classifyEpicsEntry(parts: string[], kind: "file" | "dir"): PathClass {
	const dirName = parts[0];
	if (dirName === undefined || dirName.startsWith(".")) {
		return { type: "ignored" };
	}

	if (parts.length === 1) {
		if (kind === "file") {
			return { type: "invalid", message: INVALID_MESSAGES.fileInEpicsRoot };
		}
		const epicId = EPIC_DIR_RE.exec(dirName)?.[1];
		return epicId !== undefined
			? { type: "epicDir", epicId }
			: { type: "invalid", message: INVALID_MESSAGES.epicDirName };
	}

	const entryName = parts[1];
	if (parts.length === 2 && entryName !== undefined) {
		if (entryName.startsWith(".")) return { type: "ignored" };
		const epicId = EPIC_DIR_RE.exec(dirName)?.[1];
		// The parent epic directory is itself invalid; it carries the banner.
		if (epicId === undefined) return { type: "ignored" };
		if (kind === "dir") {
			return { type: "invalid", message: INVALID_MESSAGES.storyFileName };
		}
		if (entryName === "epic.md") return { type: "epic", epicId };
		if (STORY_FILE_RE.test(entryName)) return { type: "story", epicId };
		return { type: "invalid", message: INVALID_MESSAGES.storyFileName };
	}

	// Deeper than a story file: below a directory already flagged at depth 2.
	return { type: "ignored" };
}

function classifyShapingEntry(
	parts: string[],
	kind: "file" | "dir",
): PathClass {
	const entryName = parts[0];
	if (entryName === undefined || entryName.startsWith(".")) {
		return { type: "ignored" };
	}
	if (parts.length > 1) {
		// Below a directory already flagged at depth 1.
		return { type: "ignored" };
	}
	if (kind === "file" && SHAPING_FILE_RE.test(entryName)) {
		return { type: "shaping" };
	}
	return { type: "invalid", message: INVALID_MESSAGES.shapingEntry };
}

export function classify(
	boardRoot: string,
	path: string,
	kind: "file" | "dir",
): PathClass {
	const rel = relative(boardRoot, path);
	if (rel === "" || rel.startsWith("..")) return { type: "ignored" };
	const [top, ...parts] = rel.split(sep);
	if (top === "epics") return classifyEpicsEntry(parts, kind);
	if (top === "shaping") return classifyShapingEntry(parts, kind);
	return { type: "ignored" };
}

// A path index keyed by parsed id, `id -> paths`. Duplicate ids (`> 1` holder)
// are the collision the scan layer must fail loud on.
export type IdIndex = Map<string, Set<string>>;

export function addToIndex(index: IdIndex, id: string, path: string): void {
	const set = index.get(id);
	if (set === undefined) index.set(id, new Set([path]));
	else set.add(path);
}

export function removeFromIndex(
	index: IdIndex,
	id: string,
	path: string,
): void {
	const set = index.get(id);
	if (set === undefined) return;
	set.delete(path);
	if (set.size === 0) index.delete(id);
}

export function storyOrdinal(path: string): string | undefined {
	return STORY_FILE_RE.exec(basename(path))?.[1];
}

function parseFrontmatter<S extends z.ZodType>(
	path: string,
	raw: string,
	schema: S,
): { value: z.output<S>; body: string } {
	const split = splitFrontmatter(raw);
	if (split === undefined) {
		throw new InvalidBoardFileError(path, "missing frontmatter fence");
	}
	let data: unknown;
	try {
		data = parseYaml(split.head);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new InvalidBoardFileError(
			path,
			`frontmatter is not valid YAML: ${detail}`,
		);
	}
	const result = schema.safeParse(data);
	if (!result.success) {
		throw new InvalidBoardFileError(path, z.prettifyError(result.error));
	}
	return { value: result.data, body: split.body };
}

export async function readStoryFile(
	path: string,
	epicId: string,
): Promise<Story> {
	const raw = await readFile(path, "utf8");
	const ordinal = storyOrdinal(path);
	if (ordinal === undefined) {
		throw new InvalidBoardFileError(path, INVALID_MESSAGES.storyFileName);
	}
	const { value, body } = parseFrontmatter(path, raw, storyFrontmatterSchema);
	const expectedId = `${epicId}-${ordinal}`;
	if (value.id !== expectedId) {
		throw new InvalidBoardFileError(
			path,
			`frontmatter id ${value.id} does not match path-derived id ${expectedId}`,
		);
	}
	return {
		id: value.id,
		epicId,
		path,
		frontmatter: value,
		brief: parseBrief(body),
		body,
		raw,
	};
}

export async function readShapingFile(path: string): Promise<ShapingThread> {
	const raw = await readFile(path, "utf8");
	const slug = SHAPING_FILE_RE.exec(basename(path))?.[1];
	if (slug === undefined) {
		throw new InvalidBoardFileError(path, INVALID_MESSAGES.shapingEntry);
	}
	const { value, body } = parseFrontmatter(path, raw, shapingFrontmatterSchema);
	return {
		slug,
		path,
		frontmatter: value,
		title: parseBrief(body).title,
		decisions: parseDecisions(body),
		body,
		raw,
	};
}

export async function readEpicFile(path: string): Promise<Epic> {
	const raw = await readFile(path, "utf8");
	const dirMatch = EPIC_DIR_RE.exec(basename(dirname(path)));
	const id = dirMatch?.[1];
	const slug = dirMatch?.[2];
	if (id === undefined || slug === undefined) {
		throw new InvalidBoardFileError(path, INVALID_MESSAGES.epicDirName);
	}
	const { value, body } = parseFrontmatter(path, raw, epicFrontmatterSchema);
	return {
		id,
		slug,
		path,
		frontmatter: value,
		title: parseBrief(body).title,
		body,
		raw,
	};
}

export function boardRoot(repoPath: string): string {
	return join(repoPath, ".helm", "board");
}

export function boardDir(repoPath: string): string {
	return join(boardRoot(repoPath), "epics");
}

export function shapingDir(repoPath: string): string {
	return join(boardRoot(repoPath), "shaping");
}

export function shapingPath(repoPath: string, slug: string): string {
	return join(shapingDir(repoPath), `${slug}.md`);
}

export function epicFilePath(epicDir: string): string {
	return join(epicDir, "epic.md");
}

export async function ensureBoard(repoPath: string): Promise<void> {
	await mkdir(boardDir(repoPath), { recursive: true });
	await mkdir(shapingDir(repoPath), { recursive: true });
}

function sortedByName(entries: Dirent[]): Dirent[] {
	return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

function byPath<T extends { path: string }>(a: T, b: T): number {
	return a.path.localeCompare(b.path);
}

// The live shape both the loader and the watcher build: entities keyed by
// path plus the id indexes the duplicate-ordinal rule needs. `loadBoard`
// flattens it; the watcher seeds its own maps from it.
export interface ScanResult {
	epics: Map<string, Epic>;
	stories: Map<string, Story>;
	shaping: Map<string, ShapingThread>;
	invalid: Map<string, string>;
	epicDirIds: IdIndex;
	storyIds: IdIndex;
}

async function scanEpicDir(
	root: string,
	dirPath: string,
	epicId: string,
	scan: ScanResult,
): Promise<void> {
	const entries = await readdir(dirPath, { withFileTypes: true });
	for (const entry of sortedByName(entries)) {
		const path = join(dirPath, entry.name);
		const kind = entry.isDirectory() ? "dir" : "file";
		const c = classify(root, path, kind);
		if (c.type === "ignored") continue;
		if (c.type === "invalid") {
			scan.invalid.set(path, c.message);
			continue;
		}
		if (c.type === "epic") {
			try {
				scan.epics.set(path, await readEpicFile(path));
			} catch (error) {
				if (isENOENT(error)) continue;
				scan.invalid.set(path, invalidFrom(path, error).message);
			}
		} else if (c.type === "story") {
			const ordinal = storyOrdinal(path);
			if (ordinal !== undefined) {
				addToIndex(scan.storyIds, `${epicId}-${ordinal}`, path);
			}
			try {
				scan.stories.set(path, await readStoryFile(path, epicId));
			} catch (error) {
				if (isENOENT(error)) continue;
				scan.invalid.set(path, invalidFrom(path, error).message);
			}
		}
	}
}

function resolveCollisions(scan: ScanResult): void {
	for (const [epicId, dirs] of scan.epicDirIds) {
		if (dirs.size <= 1) continue;
		for (const dir of dirs) {
			scan.epics.delete(epicFilePath(dir));
			scan.invalid.set(dir, duplicateEpicMessage(epicId));
		}
	}
	for (const [storyId, paths] of scan.storyIds) {
		if (paths.size <= 1) continue;
		for (const path of paths) {
			scan.stories.delete(path);
			scan.invalid.set(path, duplicateStoryMessage(storyId));
		}
	}
}

async function scanShapingDir(root: string, scan: ScanResult): Promise<void> {
	const dir = join(root, "shaping");
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (isENOENT(error)) return;
		throw error;
	}
	for (const entry of sortedByName(entries)) {
		const path = join(dir, entry.name);
		const c = classify(root, path, entry.isDirectory() ? "dir" : "file");
		if (c.type === "invalid") {
			scan.invalid.set(path, c.message);
			continue;
		}
		if (c.type !== "shaping") continue;
		try {
			scan.shaping.set(path, await readShapingFile(path));
		} catch (error) {
			if (isENOENT(error)) continue;
			scan.invalid.set(path, invalidFrom(path, error).message);
		}
	}
}

export async function scanBoard(repoPath: string): Promise<ScanResult> {
	const scan: ScanResult = {
		epics: new Map(),
		stories: new Map(),
		shaping: new Map(),
		invalid: new Map(),
		epicDirIds: new Map(),
		storyIds: new Map(),
	};
	const root = boardRoot(repoPath);
	await scanShapingDir(root, scan);
	const epicsDir = boardDir(repoPath);
	let entries: Dirent[];
	try {
		entries = await readdir(epicsDir, { withFileTypes: true });
	} catch (error) {
		if (isENOENT(error)) return scan;
		throw error;
	}
	for (const entry of sortedByName(entries)) {
		const path = join(epicsDir, entry.name);
		const c = classify(root, path, entry.isDirectory() ? "dir" : "file");
		if (c.type === "ignored") continue;
		if (c.type === "invalid") {
			scan.invalid.set(path, c.message);
			continue;
		}
		if (c.type === "epicDir") {
			addToIndex(scan.epicDirIds, c.epicId, path);
			await scanEpicDir(root, path, c.epicId, scan);
		}
	}
	resolveCollisions(scan);
	return scan;
}

export async function loadBoard(repoPath: string): Promise<Board> {
	const scan = await scanBoard(repoPath);
	return {
		epics: [...scan.epics.values()].sort(byPath),
		stories: [...scan.stories.values()].sort(byPath),
		shaping: [...scan.shaping.values()].sort(byPath),
		invalid: [...scan.invalid.entries()]
			.map(([path, message]) => ({ path, message }))
			.sort(byPath),
	};
}

export async function writeStory(
	story: Pick<Story, "path" | "frontmatter" | "body">,
): Promise<void> {
	await writeFile(
		story.path,
		serializeStory(story.frontmatter, story.body),
		"utf8",
	);
}

export async function writeEpic(
	epic: Pick<Epic, "path" | "frontmatter" | "body">,
): Promise<void> {
	await writeFile(
		epic.path,
		serializeEpic(epic.frontmatter, epic.body),
		"utf8",
	);
}

// Session ids attach through a fresh read-modify-write so a hand edit made
// since the last snapshot survives; callers serialize through the write
// queue like every other board write.
export async function attachEpicSession(
	path: string,
	kind: keyof EpicFrontmatter["sessions"],
	sessionId: string,
): Promise<void> {
	const epic = await readEpicFile(path);
	await writeEpic({
		path,
		frontmatter: {
			...epic.frontmatter,
			sessions: { ...epic.frontmatter.sessions, [kind]: sessionId },
		},
		body: epic.body,
	});
}

export async function writeShaping(
	thread: Pick<ShapingThread, "path" | "frontmatter" | "body">,
): Promise<void> {
	await writeFile(
		thread.path,
		serializeShaping(thread.frontmatter, thread.body),
		"utf8",
	);
}

export async function attachShapingSession(
	path: string,
	sessionId: string,
): Promise<void> {
	const thread = await readShapingFile(path);
	await writeShaping({
		path,
		frontmatter: { sessions: { shape: sessionId } },
		body: thread.body,
	});
}
