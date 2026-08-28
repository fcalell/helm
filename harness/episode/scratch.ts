import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "@fcalell/plugin-api/schema";
import { briefHash } from "../../src/board/hash.ts";
import { serializeStory } from "../../src/board/markdown.ts";
import {
	type gateSchema,
	type Status,
	storyFrontmatterSchema,
} from "../../src/board/schema.ts";

export const HELM_REPO = fileURLToPath(
	new URL("../../", import.meta.url),
).replace(/\/$/, "");
export const STUB_DIR = join(HELM_REPO, "harness/stub-claude");
export const HARNESS_ROOT = "/tmp/helm-harness";

export const STORY_ID = "001-01";

// A hand-authored `gate` block, in the shape a story file carries it.
export type GateFixture = z.input<typeof gateSchema>;

export interface StoryFixture {
	id: string;
	status?: Status;
	gate?: GateFixture;
	// The brief body, when the episode needs one the default does not cover.
	body?: string;
}

export interface ScratchOptions {
	// The default story's status, gate block and brief body.
	status?: Status;
	gate?: GateFixture;
	body?: string;
	// Stories beyond the default one.
	stories?: StoryFixture[];
}

export interface Scratch {
	name: string;
	root: string;
	repo: string;
	storyId: string;
	storyPath: string;
	// Every fixture story's file, keyed by story id.
	storyPaths: Record<string, string>;
	scriptsDir: string;
	logPath: string;
}

const STORY_BODY = [
	"# Gate harness fixture",
	"",
	"## Goal",
	"",
	"Give a gate episode a story whose brief already passes the ready gate.",
	"",
	"## Approach",
	"",
	"Hold every section the ready gate checks, and no gate verdict, so a move",
	"into Ready starts an attempt instead of short-circuiting to Ready.",
	"",
	"## Blast radius",
	"",
	"The scratch repo only.",
	"",
	"## Acceptance criteria",
	"",
	"- [ ] The story reaches Ready with a recorded gate verdict (file)",
	"",
	"## Out of scope",
	"",
	"Everything the episode does not drive.",
	"",
	"## Open questions",
	"",
].join("\n");

// A story a run can start from: Ready, with a verdict whose hash matches the
// body above, so `validateStart` sees the gate as current.
export const READY_GATE: GateFixture = {
	passed: "2026-01-01T00:00:00.000Z",
	brief: briefHash(STORY_BODY),
	overrides: [],
	rounds: [],
};

function git(repo: string, ...args: string[]): void {
	execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

function storyFilePath(epicDir: string, id: string): string {
	return join(epicDir, `${id.slice(4)}-gate.md`);
}

// The board fixture is written directly: there is no `story.create`
// procedure, and every episode needs a brief that already passes
// `checkReadyGate`. After this, every state change goes through the API.
export function setupScratch(
	name: string,
	options: ScratchOptions = {},
): Scratch {
	const root = join(HARNESS_ROOT, name);
	// The repo directory carries the episode name because `worktreesDir` keys
	// on its basename (`src/server/worktrees.ts:25-27`): a shared name would
	// put every episode's run worktrees in one directory, and a review close
	// keeps its worktree, so the next episode would collide with it.
	const repo = join(root, name);
	const epicDir = join(repo, ".helm/board/epics/001-harness");
	const storyPath = storyFilePath(epicDir, STORY_ID);
	const fixtures: StoryFixture[] = [
		{
			id: STORY_ID,
			status: options.status,
			gate: options.gate,
			body: options.body,
		},
		...(options.stories ?? []),
	];
	const storyPaths: Record<string, string> = {};

	rmSync(root, { recursive: true, force: true });
	rmSync(join(homedir(), ".helm", "worktrees", name), {
		recursive: true,
		force: true,
	});
	mkdirSync(epicDir, { recursive: true });
	execFileSync("git", ["init", "-q", "-b", "master", repo], {
		stdio: "ignore",
	});
	writeFileSync(join(repo, "README.md"), "# Harness scratch\n");
	// `epicFrontmatterSchema` is strict and holds only `sessions`
	// (`src/board/schema.ts:85-87`); an `id:` key drops the epic silently.
	writeFileSync(
		join(epicDir, "epic.md"),
		"---\nsessions: {}\n---\n# Harness\n\n## Goal\n\nDrive gate episodes.\n\n## Rationale\n\nScratch epic.\n",
	);
	for (const fixture of fixtures) {
		const path = storyFilePath(epicDir, fixture.id);
		storyPaths[fixture.id] = path;
		writeFileSync(
			path,
			serializeStory(
				storyFrontmatterSchema.parse({
					id: fixture.id,
					status: fixture.status ?? "refining",
					depends: [],
					gate: fixture.gate,
					sessions: {},
					runs: [],
				}),
				fixture.body ?? STORY_BODY,
			),
		);
	}
	git(repo, "add", "-A");
	git(
		repo,
		"-c",
		"user.email=harness@local",
		"-c",
		"user.name=harness",
		"commit",
		"-qm",
		"fixture",
	);

	writeFileSync(
		join(root, "helm.config.json"),
		`${JSON.stringify({ repos: [{ path: repo, mainBranch: "master" }] }, null, "\t")}\n`,
	);
	mkdirSync(join(root, "dist"), { recursive: true });
	symlinkSync(join(HELM_REPO, "dist/client"), join(root, "dist/client"));

	const scriptsDir = join(root, "scripts");
	mkdirSync(scriptsDir, { recursive: true });
	const logPath = join(root, "spawns.log");
	writeFileSync(logPath, "");

	return {
		name,
		root,
		repo,
		storyId: STORY_ID,
		storyPath,
		storyPaths,
		scriptsDir,
		logPath,
	};
}
