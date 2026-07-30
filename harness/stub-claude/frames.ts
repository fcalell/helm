import { randomUUID } from "node:crypto";
import type { ParsedArgv } from "./argv.ts";

// The two frames the orchestrator parses strictly: `system/init`
// (`src/sessions/events.ts:14-21`) and `result` (`:46-59`). Every frame
// carries the session id, and the id is always a uuid: the hub validates it
// on broadcast and a ZodError there takes the server down.

export function initFrame(
	sessionId: string,
	argv: ParsedArgv,
): Record<string, unknown> {
	return {
		type: "system",
		subtype: "init",
		session_id: sessionId,
		cwd: process.cwd(),
		tools: argv.tools,
		mcp_servers: [{ name: "helm", status: "connected" }],
		model: argv.model ?? "stub",
		permissionMode: argv.permissionMode ?? "default",
		slash_commands: [],
		apiKeySource: "none",
		output_style: "default",
		uuid: randomUUID(),
	};
}

// Zero usage everywhere: the stub authors its own numbers, so the meter must
// never read as evidence of spend.
export function resultFrame(
	sessionId: string,
	text: string,
	startedAt: number,
): Record<string, unknown> {
	return {
		type: "result",
		subtype: "success",
		session_id: sessionId,
		is_error: false,
		duration_ms: Date.now() - startedAt,
		duration_api_ms: 0,
		num_turns: 1,
		result: text,
		total_cost_usd: 0,
		usage: {
			input_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			output_tokens: 0,
		},
		uuid: randomUUID(),
	};
}
