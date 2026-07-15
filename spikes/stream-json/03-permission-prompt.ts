// --permission-prompt-tool round-trip: the CLI asks our MCP server for
// approval of a Bash call. We hold the response to measure how long the held
// call can block, first with default timeouts, then with MCP_TOOL_TIMEOUT
// raised.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { runClaude, setupToyRepo, summarize, TOY_REPO } from "./lib.ts";

setupToyRepo();

const holdMs = Number(process.argv[2] ?? 75_000);
let callLog: string[] = [];

function buildMcpServer(): McpServer {
	const mcp = new McpServer({ name: "helm", version: "0.0.0" });
	mcp.registerTool(
		"permission_prompt",
		{
			description: "Approve or deny a tool call.",
			inputSchema: {
				tool_name: z.string(),
				input: z.record(z.string(), z.unknown()),
				tool_use_id: z.string().optional(),
			},
		},
		async ({ tool_name, input }) => {
			const started = Date.now();
			callLog.push(`asked for ${tool_name} ${JSON.stringify(input)}`);
			console.log(`  [server] permission asked: ${tool_name}, holding…`);
			await new Promise((resolve) => setTimeout(resolve, holdMs));
			callLog.push(`approved after ${Date.now() - started}ms`);
			console.log(`  [server] approving after ${Date.now() - started}ms`);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							behavior: "allow",
							updatedInput: input,
						}),
					},
				],
			};
		},
	);
	return mcp;
}

const httpServer = createServer(async (req, res) => {
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	await buildMcpServer().connect(transport);
	await transport.handleRequest(req, res);
});
await new Promise<void>((resolve) =>
	httpServer.listen(0, "127.0.0.1", resolve),
);
const address = httpServer.address();
if (address === null || typeof address === "string")
	throw new Error("no port");
const mcpConfig = JSON.stringify({
	mcpServers: { helm: { type: "http", url: `http://127.0.0.1:${address.port}/mcp` } },
});

const baseArgs = [
	"--mcp-config",
	mcpConfig,
	"--strict-mcp-config",
	"--permission-prompt-tool",
	"mcp__helm__permission_prompt",
];
// Must be a mutating command: read-only ones (git log, ls) pass the CLI's
// safe-command allowlist without consulting the permission tool.
const prompt =
	"Run this exact command with the Bash tool: echo hi > perm.txt " +
	"Then reply 'done'.";

console.log(`hold=${holdMs}ms, default env`);
const defaultRun = await runClaude({
	cwd: TOY_REPO,
	prompt,
	args: baseArgs,
	timeoutMs: holdMs + 120_000,
});
console.log(summarize(defaultRun));
console.log(
	"  permission_denials:",
	JSON.stringify(
		(defaultRun.events.find((e) => e.type === "result") as
			| { permission_denials?: unknown }
			| undefined)?.permission_denials,
	),
);
console.log("  call log:", JSON.stringify(callLog));

if (process.argv[3] === "once") {
	httpServer.close();
	process.exit(0);
}

callLog = [];
console.log(`\nhold=${holdMs}ms, MCP_TOOL_TIMEOUT=600000`);
const raisedRun = await runClaude({
	cwd: TOY_REPO,
	prompt,
	args: baseArgs,
	env: { MCP_TOOL_TIMEOUT: "600000" },
	timeoutMs: holdMs + 120_000,
});
console.log(summarize(raisedRun));
console.log("  call log:", JSON.stringify(callLog));

httpServer.close();
