import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { KIND_REGISTRY, MCP_SERVER_NAME } from "../../sessions/kinds.ts";
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

// A fresh server per request (the spike-verified stateless pattern); the
// closure over `binding` is what binds every tool call to its session and card.
export function buildMcpServer(binding: SpawnBinding): McpServer {
	const mcp = new McpServer({ name: MCP_SERVER_NAME, version: "0.0.0" });
	const register = mcp.registerTool.bind(mcp) as unknown as RegisterTool;
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
