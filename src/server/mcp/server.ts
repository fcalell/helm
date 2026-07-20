import { z } from "@fcalell/plugin-api/schema";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { KIND_REGISTRY, MCP_SERVER_NAME } from "../../sessions/kinds.ts";
import { recordPermission } from "../services/proposals.ts";
import type { SpawnBinding } from "./registry.ts";
import { TOOL_TABLE } from "./tools.ts";

// SDK 1.29 types `registerTool` against zod-core's `$ZodType`, which our zod
// re-export does not structurally satisfy even though it is the same schema at
// runtime. This local signature crosses that type-identity gap; the SDK still
// validates input and derives the tool's JSON schema from the object schema.
type RegisterTool = (
	name: string,
	config: { description: string; inputSchema: unknown },
	cb: (args: unknown) => Promise<CallToolResult>,
) => void;

// The permission-prompt call the CLI (never the model) makes: loose because
// the caller's shape is the CLI's contract, not ours.
const approveInputSchema = z.looseObject({
	tool_name: z.string(),
	input: z.record(z.string(), z.unknown()).default({}),
	tool_use_id: z.string().optional(),
});

// The `--permission-prompt-tool` handler for supervised runs: holds the call
// until the user approves or denies from the card. Text content is the CLI's
// contract: `{"behavior":"allow","updatedInput":<input>}` releases the call,
// `{"behavior":"deny","message"}` blocks it.
async function handleApprove(
	binding: SpawnBinding,
	args: unknown,
): Promise<CallToolResult> {
	const parsed = approveInputSchema.safeParse(args);
	if (!parsed.success || binding.attach?.type !== "story") {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						behavior: "deny",
						message: "malformed permission request",
					}),
				},
			],
		};
	}
	const approved = await recordPermission(
		binding.attach.id,
		parsed.data.tool_name,
		parsed.data.input,
	);
	const verdict = approved
		? { behavior: "allow", updatedInput: parsed.data.input }
		: { behavior: "deny", message: "denied from the board" };
	return { content: [{ type: "text", text: JSON.stringify(verdict) }] };
}

// A fresh server per request (the spike-verified stateless pattern); the
// closure over `binding` is what binds every tool call to its session and card.
export function buildMcpServer(binding: SpawnBinding): McpServer {
	const mcp = new McpServer({ name: MCP_SERVER_NAME, version: "0.0.0" });
	const register = mcp.registerTool.bind(mcp) as unknown as RegisterTool;
	if (binding.kind === "run") {
		register(
			"approve",
			{
				description:
					"Permission prompt for supervised runs; called by the CLI, not the model.",
				inputSchema: approveInputSchema,
			},
			(args) => handleApprove(binding, args),
		);
	}
	for (const name of KIND_REGISTRY[binding.kind].boardTools ?? []) {
		const def = TOOL_TABLE[name];
		register(
			name,
			{
				description: def.description,
				inputSchema: def.inputSchema(binding.kind),
			},
			async (args) => {
				const { sessionId } = binding;
				if (sessionId === undefined) {
					return {
						content: [{ type: "text", text: "session is not initialized yet" }],
						isError: true,
					};
				}
				return def.handle({ ...binding, sessionId }, args);
			},
		);
	}
	return mcp;
}
