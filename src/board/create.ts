import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildEpicBody, buildStoryBody } from "./markdown.ts";
import type { StoryFrontmatter } from "./schema.ts";
import { boardDir, epicFilePath, writeEpic, writeStory } from "./store.ts";

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
