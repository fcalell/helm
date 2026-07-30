import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ParsedArgv } from "./argv.ts";

// The two frames the orchestrator parses strictly: `system/init`
// (`src/sessions/events.ts:14-21`) and `result` (`:46-59`). Both parse as
// loose objects, so the stub emits the CLI's whole field set rather than the
// parsed subset: a stub that drifts from what the CLI really sends verifies
// nothing. `recorded-frames.json` is one live spawn captured verbatim, and
// re-recording it against a newer CLI is what shows the shape moved.
// Every frame carries the session id, and the id is always a uuid: the hub
// validates it on broadcast and a ZodError there takes the server down.
interface Recording {
	init: Record<string, unknown>;
	result: Record<string, unknown>;
}

const recorded = JSON.parse(
	readFileSync(new URL("./recorded-frames.json", import.meta.url), "utf8"),
) as Recording;

export function initFrame(
	sessionId: string,
	argv: ParsedArgv,
): Record<string, unknown> {
	return {
		...recorded.init,
		session_id: sessionId,
		uuid: randomUUID(),
		cwd: process.cwd(),
		tools: argv.tools,
		mcp_servers: [{ name: "helm", status: "connected" }],
		model: argv.model ?? "stub",
		permissionMode: argv.permissionMode ?? "default",
	};
}

// Zero usage and cost everywhere: the stub authors its own numbers, so the
// meter must never read as evidence of spend. The keys stay the recording's.
const ZERO_USAGE = {
	input_tokens: 0,
	cache_creation_input_tokens: 0,
	cache_read_input_tokens: 0,
	output_tokens: 0,
};

export function resultFrame(
	sessionId: string,
	text: string,
	startedAt: number,
): Record<string, unknown> {
	return {
		...recorded.result,
		session_id: sessionId,
		uuid: randomUUID(),
		subtype: "success",
		is_error: false,
		result: text,
		duration_ms: Date.now() - startedAt,
		duration_api_ms: 0,
		num_turns: 1,
		total_cost_usd: 0,
		usage: ZERO_USAGE,
		modelUsage: {},
	};
}
