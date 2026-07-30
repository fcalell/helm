import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeStory } from "../../src/board/markdown.ts";
import { storyFrontmatterSchema } from "../../src/board/schema.ts";

export const HELM_REPO = fileURLToPath(
	new URL("../../", import.meta.url),
).replace(/\/$/, "");
export const STUB_DIR = join(HELM_REPO, "harness/stub-claude");
export const HARNESS_ROOT = "/tmp/helm-harness";

export const STORY_ID = "001-01";

export interface Scratch {
	name: string;
	root: string;
	repo: string;
	storyId: string;
	storyPath: string;
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

function git(repo: string, ...args: string[]): void {
	execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

// The board fixture is written directly: there is no `story.create`
// procedure, and every episode needs a brief that already passes
// `checkReadyGate`. After this, every state change goes through the API.
export function setupScratch(name: string): Scratch {
	const root = join(HARNESS_ROOT, name);
	const repo = join(root, "repo");
	const epicDir = join(repo, ".helm/board/epics/001-harness");
	const storyPath = join(epicDir, "01-gate.md");

	rmSync(root, { recursive: true, force: true });
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
	writeFileSync(
		storyPath,
		serializeStory(
			storyFrontmatterSchema.parse({
				id: STORY_ID,
				status: "refining",
				depends: [],
				sessions: {},
				runs: [],
			}),
			STORY_BODY,
		),
	);
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
		scriptsDir,
		logPath,
	};
}
