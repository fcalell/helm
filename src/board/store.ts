import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
	parseBrief,
	serializeEpic,
	serializeStory,
	splitFrontmatter,
} from "./markdown.ts";
import {
	type Board,
	type Epic,
	epicFrontmatterSchema,
	type InvalidFile,
	type Story,
	storyFrontmatterSchema,
} from "./schema.ts";

export const EPIC_DIR_RE = /^(\d{3})-([a-z0-9-]+)$/;
export const STORY_FILE_RE = /^(\d{2})-([a-z0-9-]+)\.md$/;

export type { Board, Epic, InvalidFile, Story } from "./schema.ts";

export class InvalidBoardFileError extends Error {
	readonly path: string;

	constructor(path: string, message: string) {
		super(message);
		this.name = "InvalidBoardFileError";
		this.path = path;
	}
}

export function invalidFrom(path: string, error: unknown): InvalidFile {
	if (error instanceof InvalidBoardFileError) {
		return { path, message: error.message };
	}
	if ((error as NodeJS.ErrnoException).code === "ENOENT") {
		return { path, message: "file missing" };
	}
	return {
		path,
		message: error instanceof Error ? error.message : String(error),
	};
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
	const ordinal = STORY_FILE_RE.exec(basename(path))?.[1];
	if (ordinal === undefined) {
		throw new InvalidBoardFileError(
			path,
			"story files are named <NN>-<slug>.md",
		);
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

export async function readEpicFile(path: string): Promise<Epic> {
	const raw = await readFile(path, "utf8");
	const dirMatch = EPIC_DIR_RE.exec(basename(dirname(path)));
	const id = dirMatch?.[1];
	const slug = dirMatch?.[2];
	if (id === undefined || slug === undefined) {
		throw new InvalidBoardFileError(
			path,
			"epic directories are named <NNN>-<slug>",
		);
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

export function boardDir(repoPath: string): string {
	return join(repoPath, ".helm", "epics");
}

export async function ensureBoard(repoPath: string): Promise<void> {
	await mkdir(boardDir(repoPath), { recursive: true });
}

function sortedByName(entries: Dirent[]): Dirent[] {
	return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

async function loadEpicDir(
	dirPath: string,
	epicId: string,
	board: Board,
): Promise<void> {
	const epicFile = join(dirPath, "epic.md");
	try {
		board.epics.push(await readEpicFile(epicFile));
	} catch (error) {
		board.invalid.push(invalidFrom(epicFile, error));
	}
	const entries = await readdir(dirPath, { withFileTypes: true });
	for (const entry of sortedByName(entries)) {
		if (entry.name === "epic.md" || entry.name.startsWith(".")) continue;
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const path = join(dirPath, entry.name);
		try {
			board.stories.push(await readStoryFile(path, epicId));
		} catch (error) {
			board.invalid.push(invalidFrom(path, error));
		}
	}
}

export async function loadBoard(repoPath: string): Promise<Board> {
	const board: Board = { epics: [], stories: [], invalid: [] };
	const dir = boardDir(repoPath);
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return board;
		throw error;
	}
	for (const entry of sortedByName(entries)) {
		if (entry.name.startsWith(".")) continue;
		const path = join(dir, entry.name);
		if (!entry.isDirectory()) {
			board.invalid.push({
				path,
				message: "unexpected file: boards contain only epic directories",
			});
			continue;
		}
		const epicId = EPIC_DIR_RE.exec(entry.name)?.[1];
		if (epicId === undefined) {
			board.invalid.push({
				path,
				message: "epic directories are named <NNN>-<slug>",
			});
			continue;
		}
		await loadEpicDir(path, epicId, board);
	}
	return board;
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
