// Host a streamable-HTTP MCP server in-process, hand it to `claude -p` via
// --mcp-config, and verify a board-tool call lands back in this process.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { runClaude, setupToyRepo, summarize, TOY_REPO } from "./lib.ts";

setupToyRepo();

const received: unknown[] = [];

// Stateless transport: the SDK allows one transport per server instance, so
// build a fresh McpServer per request.
function buildMcpServer(): McpServer {
	const mcp = new McpServer({ name: "helm", version: "0.0.0" });
	mcp.registerTool(
		"update_card",
		{
			description:
				"Record a note on the story card. Use this to log decisions.",
			inputSchema: { note: z.string().describe("The note to record") },
		},
		async ({ note }) => {
			received.push(note);
			console.log(`  [server] update_card called: ${note}`);
			return { content: [{ type: "text", text: "recorded" }] };
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
const url = `http://127.0.0.1:${address.port}/mcp`;
console.log(`MCP server on ${url}`);

const mcpConfig = JSON.stringify({
	mcpServers: { helm: { type: "http", url } },
});

const run = await runClaude({
	cwd: TOY_REPO,
	prompt:
		"Call the update_card tool exactly once with the note " +
		"'spike says hello', then reply 'done'.",
	args: [
		"--mcp-config",
		mcpConfig,
		"--strict-mcp-config",
		"--allowedTools",
		"mcp__helm__update_card",
	],
});
console.log(summarize(run));

const init = run.events.find(
	(event) => event.type === "system" && event.subtype === "init",
);
console.log(
	"mcp_servers at init:",
	JSON.stringify((init as { mcp_servers?: unknown })?.mcp_servers),
);
console.log("tool calls received in-process:", JSON.stringify(received));

httpServer.close();
if (received.length !== 1) throw new Error("expected exactly one tool call");
