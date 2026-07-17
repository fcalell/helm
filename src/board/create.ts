import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	buildEpicBody,
	buildShapingBody,
	buildStoryBody,
	serializeShaping,
} from "./markdown.ts";
import type { StoryFrontmatter } from "./schema.ts";
import {
	boardDir,
	epicFilePath,
	shapingDir,
	writeEpic,
	writeStory,
} from "./store.ts";

const SLUG_MAX = 50;

export function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, SLUG_MAX)
		.replace(/-+$/, "");
	return slug === "" ? "untitled" : slug;
}

export interface EpicSeed {
	slug: string;
	title: string;
	goal: string;
	rationale?: string;
}

export interface StorySeed {
	slug: string;
	title: string;
	goal: string;
	// Resolved sibling story ids (not slugs); the caller resolves them.
	depends: string[];
}

// Writes `<NNN>-<slug>/epic.md`. The ordinal is freshly minted, so the
// directory must not already exist (non-recursive mkdir throws otherwise).
export async function createEpic(
	repoPath: string,
	ordinal: number,
	seed: EpicSeed,
): Promise<{ epicId: string; dir: string }> {
	const epicId = String(ordinal).padStart(3, "0");
	const dir = join(boardDir(repoPath), `${epicId}-${seed.slug}`);
	await mkdir(dir);
	await writeEpic({
		path: epicFilePath(dir),
		frontmatter: { sessions: {} },
		body: buildEpicBody(seed.title, seed.goal, seed.rationale),
	});
	return { epicId, dir };
}

// Writes `.helm/board/shaping/<slug>.md` seeded with the rough goal as the
// first agreed note. The slug must be free (`wx` throws on an existing
// thread); callers dedupe before minting one.
export async function createShapingThread(
	repoPath: string,
	slug: string,
	title: string,
	goal: string,
): Promise<{ path: string }> {
	await mkdir(shapingDir(repoPath), { recursive: true });
	const path = join(shapingDir(repoPath), `${slug}.md`);
	await writeFile(
		path,
		serializeShaping({ sessions: {} }, buildShapingBody(title, goal)),
		{ encoding: "utf8", flag: "wx" },
	);
	return { path };
}

// Writes `<NN>-<slug>.md` with frontmatter `{ id, status: "backlog", depends }`.
export async function createStory(
	epicDir: string,
	epicId: string,
	ordinal: number,
	seed: StorySeed,
): Promise<{ storyId: string; path: string }> {
	const ordinalStr = String(ordinal).padStart(2, "0");
	const storyId = `${epicId}-${ordinalStr}`;
	const path = join(epicDir, `${ordinalStr}-${seed.slug}.md`);
	const frontmatter: StoryFrontmatter = {
		id: storyId,
		status: "backlog",
		depends: seed.depends,
		sessions: {},
		runs: [],
	};
	await writeStory({
		path,
		frontmatter,
		body: buildStoryBody(seed.title, seed.goal),
	});
	return { storyId, path };
}
