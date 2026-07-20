// Creates the scratch target repo the live permission spike runs against
// (fresh on every invocation), with the five gated ready stories gen-story.ts
// writes.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = "/tmp/helm-scratch";
const REPO = `${ROOT}/repo`;

function git(...args: string[]): void {
	execFileSync("git", ["-C", REPO, ...args], { stdio: "inherit" });
}

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "master", REPO], { stdio: "inherit" });
writeFileSync(`${REPO}/README.md`, "# Scratch\n");

execFileSync(
	"node",
	[
		new URL("./gen-story.ts", import.meta.url).pathname,
		`${REPO}/.helm/board/epics/001-scratch`,
	],
	{ stdio: "inherit" },
);

git("add", "-A");
git(
	"-c",
	"user.email=scratch@local",
	"-c",
	"user.name=scratch",
	"commit",
	"-qm",
	"init",
);
console.log(`scratch repo ready at ${REPO}`);
