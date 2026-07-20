// Writes the scratch stories the live permission spike drives: ready, gated
// (hash computed the way the orchestrator checks it), one per scenario.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { briefHash } from "../../src/board/hash.ts";
import { serializeStory } from "../../src/board/markdown.ts";
import { storyFrontmatterSchema } from "../../src/board/schema.ts";

const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: gen-story.ts <epic-dir-or-file>");
const epicDir = dir.endsWith(".md") ? dirname(dir) : dir;

function body(title: string, goal: string): string {
	return [
		`# ${title}`,
		"",
		"## Goal",
		"",
		goal,
		"",
		"## Approach",
		"",
		"Follow the goal exactly; keep every step minimal.",
		"",
		"## Blast radius",
		"",
		"Scratch repo only.",
		"",
		"## Acceptance criteria",
		"",
		"- [ ] The goal's steps ran",
		"",
		"## Out of scope",
		"",
		"Everything else.",
		"",
		"## Open questions",
		"",
	].join("\n");
}

const stories: Array<{ file: string; id: string; title: string; goal: string }> =
	[
		{
			file: "01-hold.md",
			id: "001-01",
			title: "Hold",
			goal: "First run exactly `git status` with the Bash tool. Then create a file hold.txt containing the word held. Then run exactly `git add hold.txt` and then exactly `git commit -m 'feat: add hold marker'`. Do not run any other command. Do not call update_card.",
		},
		{
			file: "02-deny-ask.md",
			id: "001-02",
			title: "Deny and ask",
			goal: "First, run exactly `touch deny-me.txt` with the Bash tool, once; if the call is denied, accept that and never retry it. Second, call the ask_user tool asking which color to record, recommending blue, with options blue and green, and end your turn. When the user's answer arrives, write it into color.txt, run `git add color.txt`, then `git commit -m 'feat: record color'`, and finish. Do not call update_card.",
		},
		{
			file: "03-manual.md",
			id: "001-03",
			title: "Manual edit",
			goal: "Create a file manual.txt containing ok, then run `git add manual.txt` and `git commit -m 'feat: add manual marker'`. Do not run any other command. Do not call update_card.",
		},
		{
			file: "04-auto.md",
			id: "001-04",
			title: "Auto extend",
			goal: "Run exactly `touch auto-made.txt` with the Bash tool, then `git add auto-made.txt` and `git commit -m 'feat: add auto marker'`. Do not run any other command. Do not call update_card.",
		},
		{
			file: "05-invalid.md",
			id: "001-05",
			title: "Invalid allowlist",
			goal: "Create a file never.txt. This run should never spawn.",
		},
	];

// Optional third arg regenerates a single story file.
const only = process.argv[3];

mkdirSync(epicDir, { recursive: true });
for (const story of stories) {
	if (only !== undefined && story.file !== only) continue;
	const storyBody = body(story.title, story.goal);
	const frontmatter = storyFrontmatterSchema.parse({
		id: story.id,
		status: "ready",
		depends: [],
		gate: {
			passed: new Date().toISOString(),
			brief: briefHash(storyBody),
			overrides: [],
		},
		sessions: {},
		runs: [],
	});
	writeFileSync(join(epicDir, story.file), serializeStory(frontmatter, storyBody));
}
console.log(`wrote ${stories.length} stories to ${epicDir}`);
