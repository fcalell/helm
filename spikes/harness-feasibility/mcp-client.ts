// Unknown 1: can an MCP SDK *client* drive the product's `@hono/mcp` server,
// which builds a fresh server + transport per request with no session id
// (`src/server/services/mcp.ts:18-26`)? Spike 02 proved the opposite pairing
// (SDK server transport, `claude` as client), so the stub's half is unproven.
import { StreamableHTTPTransport } from "@hono/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { createServer } from "node:http";
import { z } from "@fcalell/plugin-api/schema";

const received: string[] = [];

function buildServer(): McpServer {
	const mcp = new McpServer({ name: "helm", version: "0.0.0" });
	mcp.registerTool(
		"flag_risk",
		{
			description: "Raise a risk flag.",
			inputSchema: { title: z.string().min(1), detail: z.string().min(1) },
		},
		async ({ title }) => {
			received.push(title);
			return { content: [{ type: "text", text: "recorded" }] };
		},
	);
	return mcp;
}

// Mirrors the product route exactly: token lookup, fresh server+transport.
const app = new Hono();
app.all("/mcp/:token", async (c) => {
	if (c.req.param("token") !== "tok") return c.text("unknown MCP token", 404);
	const transport = new StreamableHTTPTransport();
	await buildServer().connect(transport);
	return (await transport.handleRequest(c)) ?? c.body(null, 204);
});

// Minimal node:http bridge (the product mounts hono on the stack's server).
const httpServer = createServer((req, res) => {
	const chunks: Buffer[] = [];
	req.on("data", (chunk: Buffer) => chunks.push(chunk));
	req.on("end", () => {
		const url = `http://127.0.0.1${req.url ?? "/"}`;
		const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
		void app
			.fetch(
				new Request(url, {
					method: req.method,
					headers: req.headers as Record<string, string>,
					body,
				}),
			)
			.then(async (response) => {
				res.writeHead(
					response.status,
					Object.fromEntries(response.headers.entries()),
				);
				res.end(Buffer.from(await response.arrayBuffer()));
			});
	});
});
await new Promise<void>((resolve) =>
	httpServer.listen(0, "127.0.0.1", resolve),
);
const address = httpServer.address();
if (address === null || typeof address === "string") throw new Error("no port");
const url = new URL(`http://127.0.0.1:${address.port}/mcp/tok`);

const client = new Client({ name: "stub-claude", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(url));
console.log(
	"connected; tools:",
	(await client.listTools()).tools.map((tool) => tool.name),
);

const first = await client.callTool({
	name: "flag_risk",
	arguments: { title: "F1", detail: "d" },
});
console.log("call 1:", JSON.stringify(first.content));

// The real question: a second call hits a *different* server instance.
const second = await client.callTool({
	name: "flag_risk",
	arguments: { title: "F2", detail: "d" },
});
console.log("call 2 (fresh server instance):", JSON.stringify(second.content));

// How a rejection surfaces: as a thrown error, or as an isError result?
const bad = await client
	.callTool({ name: "flag_risk", arguments: { title: "" } })
	.then((result) => `resolved isError=${String(result.isError)} ${JSON.stringify(result.content).slice(0, 90)}`)
	.catch((error) => `threw: ${String(error).slice(0, 110)}`);
console.log("invalid payload ->", bad);

console.log("handler received:", received);
await client.close();
httpServer.close();
