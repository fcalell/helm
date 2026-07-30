import { randomUUID } from "node:crypto";
import { mcpUrlOf, type ParsedArgv, parseArgv, roleOf } from "./argv.ts";
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

const SCRIPTS_ENV = "HELM_STUB_SCRIPTS";
const LOG_ENV = "HELM_STUB_LOG";

function emit(frame: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function claimFor(dir: string, parsed: ParsedArgv): ClaimResult {
	const role = roleOf(parsed.allowedTools);
	if (role === undefined) {
		return {
			ok: false,
			reason: `no scripted role on --allowedTools: ${parsed.allowedTools.join(",")}`,
		};
	}
	return claimScript(dir, role);
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
		role: roleOf(parsed.allowedTools) ?? null,
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
