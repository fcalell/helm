// Round 2 of unknown 2. The first pass proved the *mechanism* (cwd-relative
// `helm.config.json`, cwd-relative `dist/client`, a symlink restoring the SPA)
// against a stand-in hono app. It did not start the product. This one boots the
// real orchestrator — every service in `src/server/services/index.ts`, the real
// worker, the real board watcher — from a scratch cwd, and drives one RPC.
//
// It also answers a question the brief had already decided wrongly: `.stack/
// server.ts` hardcodes port 8788, which the developer's `stack dev` already
// owns, so "run `node .stack/server.ts` by absolute path" collides. A scratch
// entry calling `startNodeServer` with its own port and absolute module URLs
// keeps everything else identical.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HELM = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const ROOT = "/tmp/helm-harness-spike2";
const REPO = `${ROOT}/repo`;
const PORT = 8799;

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(`${REPO}/.helm/board/epics/001-scratch`, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "master", REPO]);
writeFileSync(`${REPO}/README.md`, "# Scratch\n");
writeFileSync(
	`${REPO}/.helm/board/epics/001-scratch/epic.md`,
	// `epicFrontmatterSchema` is strict and holds only `sessions`
	// (`src/board/schema.ts:85-87`) — the ordinal comes from the directory name.
	// An `id:` key here silently drops the epic from the board.
	"---\nsessions: {}\n---\n# Scratch\n\n## Rationale\n\nScratch epic.\n",
);
writeFileSync(
	`${REPO}/.helm/board/epics/001-scratch/01-probe.md`,
	[
		"---",
		"id: 001-01",
		"status: refining",
		"depends: []",
		"sessions: {}",
		"---",
		"# Probe",
		"",
		"## Goal",
		"",
		"Prove the scratch orchestrator serves this board.",
		"",
		"## Approach",
		"",
		"Read it over the API.",
		"",
		"## Blast radius",
		"",
		"Scratch repo only.",
		"",
		"## Acceptance criteria",
		"",
		"- [ ] The board channel carries this story (file)",
		"",
		"## Out of scope",
		"",
		"Everything else.",
		"",
		"## Open questions",
		"",
	].join("\n"),
);
execFileSync("git", ["-C", REPO, "add", "-A"]);
execFileSync("git", [
	"-C",
	REPO,
	"-c",
	"user.email=scratch@local",
	"-c",
	"user.name=scratch",
	"commit",
	"-qm",
	"init",
]);

// The scratch cwd: its own config, a symlink to the developer's built client,
// and its own entry so the port does not collide with `stack dev`.
writeFileSync(
	`${ROOT}/helm.config.json`,
	`${JSON.stringify({ repos: [{ path: REPO, mainBranch: "master", checkCommand: "true" }] }, null, "\t")}\n`,
);
mkdirSync(`${ROOT}/dist`, { recursive: true });
symlinkSync(`${HELM}/dist/client`, `${ROOT}/dist/client`);
// The entry lives in the helm repo, not the scratch dir: node resolves bare
// specifiers by walking up from the importing *file*, so an entry written into
// `${ROOT}` cannot find `@fcalell/plugin-node` (measured first, NODE_PATH does
// not help — ESM ignores it). The process still *runs* from the scratch dir,
// which is what `helm.config.json` and `staticRoot` read.
const child = spawn(
	"node",
	[fileURLToPath(new URL("./scratch-entry.ts", import.meta.url))],
	{
		cwd: ROOT,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, HELM_SCRATCH_PORT: String(PORT) },
	},
);
let log = "";
child.stdout.on("data", (chunk: Buffer) => {
	log += chunk.toString();
});
child.stderr.on("data", (chunk: Buffer) => {
	log += chunk.toString();
});

async function waitForPort(): Promise<boolean> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			await fetch(`http://127.0.0.1:${PORT}/`);
			return true;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	return false;
}

const up = await waitForPort();
console.log("--- server log ---\n" + log.trim());
if (!up) {
	child.kill();
	throw new Error("scratch orchestrator never listened");
}

const spa = await fetch(`http://127.0.0.1:${PORT}/`);
console.log(
	`GET / -> ${spa.status} ${(await spa.text()).slice(0, 60).replace(/\n/g, " ")}`,
);

const rpc = await fetch(`http://127.0.0.1:${PORT}/rpc/board/get`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ json: {} }),
});
const board = (await rpc.text()).slice(0, 220);
console.log(`POST /rpc/board/get -> ${rpc.status} ${board}`);

child.kill();
await new Promise((resolve) => child.on("exit", resolve));
console.log("stopped; developer helm.config.json untouched");
