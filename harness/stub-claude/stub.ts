import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { kindOf, mcpUrlOf, type ParsedArgv, parseArgv } from "./argv.ts";
import { connectToolClient, type ToolClient } from "./client.ts";
import { initFrame, resultFrame } from "./frames.ts";
import { appendStubLog } from "./log.ts";
import { type ClaimResult, claimScript } from "./script.ts";

// A death before `system/init` is the only one the orchestrator sees as a
// spawn failure (`src/sessions/runner.ts:74-91`), so both configuration
// failures exit here and nothing else does.
export const NO_SCRIPT_EXIT = 2;
// A refusal the stub must not swallow: the scenario is wrong, and only the
// declared exit code makes that visible.
export const TOOL_FAILURE_EXIT = 4;
// A `wait` step whose sentinel never arrived: the episode's release beat never
// ran, and the turn must end loudly rather than hang past the observer.
export const WAIT_TIMEOUT_EXIT = 5;

// Under the observer's 45s deadline, so an unreleased turn fails the episode
// on the assertion that named it, not on a wait.
const WAIT_TIMEOUT_MS = 30_000;
const WAIT_POLL_MS = 50;

const SCRIPTS_ENV = "HELM_STUB_SCRIPTS";
const LOG_ENV = "HELM_STUB_LOG";

async function waitForSentinel(
	path: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (existsSync(path)) return true;
		if (Date.now() >= deadline) return false;
		await delay(WAIT_POLL_MS);
	}
}

function emit(frame: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function claimFor(dir: string, parsed: ParsedArgv): ClaimResult {
	const kind = kindOf(parsed.allowedTools);
	if (kind === undefined) {
		return {
			ok: false,
			reason: `no session kind on --allowedTools: ${parsed.allowedTools.join(",")}`,
		};
	}
	return claimScript(dir, kind);
}

export async function main(argv: readonly string[]): Promise<void> {
	const startedAt = Date.now();
	const parsed = parseArgv(argv);
	const scriptsDir = process.env[SCRIPTS_ENV];
	const logPath = process.env[LOG_ENV];
	const pid = process.pid;
	const claim =
		scriptsDir === undefined ? undefined : claimFor(scriptsDir, parsed);

	const finish = (code: number, reason?: string): void => {
		appendStubLog(logPath, {
			t: "exit",
			at: new Date().toISOString(),
			pid,
			code,
			...(reason === undefined ? {} : { reason }),
		});
		process.exitCode = code;
	};

	appendStubLog(logPath, {
		t: "start",
		at: new Date().toISOString(),
		pid,
		kind: kindOf(parsed.allowedTools) ?? null,
		script: claim?.ok === true ? claim.name : null,
		...(claim?.ok === false ? { failure: claim.reason } : {}),
		env: {
			scripts: scriptsDir ?? null,
			log: logPath ?? null,
			path: process.env.PATH ?? "",
		},
		argv: [...argv],
		parsed,
	});

	if (claim?.ok === false) {
		finish(NO_SCRIPT_EXIT, claim.reason);
		return;
	}

	const sessionId = parsed.resume ?? randomUUID();
	emit(initFrame(sessionId, parsed));

	if (claim === undefined) {
		emit(
			resultFrame(sessionId, "no script directory: flagless turn", startedAt),
		);
		finish(0);
		return;
	}

	const url = mcpUrlOf(parsed.mcpConfig);
	let client: ToolClient | undefined;
	const openClient = async (): Promise<ToolClient | undefined> => {
		if (client !== undefined || url === undefined) return client;
		client = await connectToolClient({
			url,
			onCall: (tool, attempt) =>
				appendStubLog(logPath, {
					t: "call",
					at: new Date().toISOString(),
					pid,
					tool,
					attempt,
				}),
			onRefusal: (tool, text, retrying) =>
				appendStubLog(logPath, {
					t: "refusal",
					at: new Date().toISOString(),
					pid,
					tool,
					text,
					retrying,
				}),
		});
		return client;
	};

	for (const step of claim.script.steps) {
		if (step.t === "emit") {
			emit({ ...step.event, session_id: sessionId });
			continue;
		}
		if (step.t === "exit") {
			await client?.close();
			finish(step.code, `script ${claim.name} exit step`);
			return;
		}
		if (step.t === "wait") {
			const sentinel = isAbsolute(step.sentinel)
				? step.sentinel
				: join(scriptsDir ?? ".", step.sentinel);
			const released = await waitForSentinel(
				sentinel,
				step.timeoutMs ?? WAIT_TIMEOUT_MS,
			);
			if (released) continue;
			await client?.close();
			finish(
				WAIT_TIMEOUT_EXIT,
				`script ${claim.name} waited for ${sentinel} and it never appeared`,
			);
			return;
		}
		const tools = await openClient();
		if (tools === undefined) {
			finish(TOOL_FAILURE_EXIT, "no helm MCP url on --mcp-config");
			return;
		}
		const outcome = await tools.call(step.tool, step.payload);
		if (!outcome.ok) {
			await tools.close();
			finish(TOOL_FAILURE_EXIT, `${step.tool}: ${outcome.text}`);
			return;
		}
	}

	await client?.close();
	emit(resultFrame(sessionId, `script ${claim.name} done`, startedAt));
	finish(0);
}
