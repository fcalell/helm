// Lifecycle unknowns: does the Stop hook fire on normal end and on SIGTERM
// mid-tool-call; does a killed session resume; does resume survive transcript
// deletion; does resume survive a deleted-and-recreated cwd.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import {
	runClaude,
	setupToyRepo,
	type StreamEvent,
	summarize,
	TOY_REPO,
} from "./lib.ts";

setupToyRepo();

// --- Stop-hook receiver -----------------------------------------------------
const hookHits: string[] = [];
const hookServer = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk: Buffer) => {
		body += chunk.toString();
	});
	req.on("end", () => {
		hookHits.push(`${req.url} ${body.slice(0, 120)}`);
		res.end("ok");
	});
});
await new Promise<void>((resolve) =>
	hookServer.listen(0, "127.0.0.1", resolve),
);
const hookAddress = hookServer.address();
if (hookAddress === null || typeof hookAddress === "string")
	throw new Error("no port");
const hookSettings = JSON.stringify({
	hooks: {
		Stop: [
			{
				hooks: [
					{
						type: "command",
						command: `curl -s -m 2 -X POST http://127.0.0.1:${hookAddress.port}/stop -d hook-fired`,
					},
				],
			},
		],
	},
});

// --- A1: Stop hook on normal completion --------------------------------------
console.log("A1: stop hook, normal completion");
const control = await runClaude({
	cwd: TOY_REPO,
	prompt: "Reply with exactly: ok",
	args: ["--settings", hookSettings],
});
console.log(summarize(control));
console.log("  hook hits:", JSON.stringify(hookHits));

// --- A2: SIGTERM mid-tool-call, then resume ----------------------------------
console.log("\nA2: SIGTERM mid-tool-call");
hookHits.length = 0;
let pid: number | undefined;
let killed = false;
function killOnToolUse(event: StreamEvent): void {
	if (killed || event.type !== "assistant") return;
	const message = (event as { message?: { content?: unknown } }).message;
	const content = Array.isArray(message?.content) ? message.content : [];
	const hasToolUse = content.some(
		(block: unknown) =>
			typeof block === "object" &&
			block !== null &&
			(block as { type?: string }).type === "tool_use",
	);
	if (hasToolUse && pid !== undefined) {
		killed = true;
		console.log("  [spike] tool_use seen, SIGTERM in 2s");
		setTimeout(() => process.kill(pid as number, "SIGTERM"), 2_000);
	}
}
// Busy-wait instead of `sleep`: settings-level rules can block a bare sleep,
// which would end the tool call before the kill lands.
const killedRun = await runClaude({
	cwd: TOY_REPO,
	prompt:
		"Run this exact command with the Bash tool: " +
		'node -e "const t=Date.now();while(Date.now()-t<30000){}"',
	args: ["--settings", hookSettings, "--allowedTools", "Bash"],
	onSpawn: (p) => {
		pid = p;
	},
	onEvent: killOnToolUse,
});
console.log(summarize(killedRun));
// Give a fired hook a moment to reach the receiver.
await new Promise((resolve) => setTimeout(resolve, 3_000));
console.log("  hook hits after SIGTERM:", JSON.stringify(hookHits));

console.log("\nA3: resume the killed session");
if (killedRun.sessionId === undefined) throw new Error("no session id");
const resumedAfterKill = await runClaude({
	cwd: TOY_REPO,
	prompt:
		"In one line: what was the last command you were running before this " +
		"message?",
	args: ["--resume", killedRun.sessionId],
});
console.log(summarize(resumedAfterKill));

// --- B: resume after transcript deletion --------------------------------------
console.log("\nB: resume after transcript deletion");
const doomed = await runClaude({
	cwd: TOY_REPO,
	prompt: "Reply with exactly: ok",
});
if (doomed.sessionId === undefined) throw new Error("no session id");
const projectsDir = `${homedir()}/.claude/projects`;
const transcript = execFileSync(
	"find",
	[projectsDir, "-name", `${doomed.sessionId}.jsonl`],
	{ encoding: "utf8" },
).trim();
console.log(`  transcript: ${transcript || "<not found>"}`);
if (transcript !== "") rmSync(transcript);
const resumedAfterDelete = await runClaude({
	cwd: TOY_REPO,
	prompt: "Reply with exactly: ok",
	args: ["--resume", doomed.sessionId],
});
console.log(summarize(resumedAfterDelete));
console.log(`  stderr: ${resumedAfterDelete.stderr.slice(0, 300)}`);

// --- C: resume from deleted-and-recreated cwd ---------------------------------
console.log("\nC: resume from deleted-and-recreated cwd");
const worktree = new URL("./fake-worktree/", import.meta.url).pathname;
rmSync(worktree, { recursive: true, force: true });
mkdirSync(worktree);
execFileSync("git", ["init", "-q"], { cwd: worktree });
const inWorktree = await runClaude({
	cwd: worktree,
	prompt: "Reply with exactly: ok",
});
if (inWorktree.sessionId === undefined) throw new Error("no session id");
rmSync(worktree, { recursive: true, force: true });
mkdirSync(worktree);
execFileSync("git", ["init", "-q"], { cwd: worktree });
console.log(`  recreated ${worktree}, exists: ${existsSync(worktree)}`);
const resumedInRecreated = await runClaude({
	cwd: worktree,
	prompt: "Reply with exactly: ok",
	args: ["--resume", inWorktree.sessionId],
});
console.log(summarize(resumedInRecreated));
console.log(`  stderr: ${resumedInRecreated.stderr.slice(0, 300)}`);

hookServer.close();
