// Round 2 of unknown 1. The first pass registered a raw zod *shape* against a
// hand-rolled `node:http` bridge, which is not the product's path: `server.ts`
// registers a whole zod **object schema** through an
// `as unknown as RegisterTool` cast (`src/server/mcp/server.ts:14-18,80,92-111`)
// and mounts hono on the stack's node server via `ctx.http.mount`
// (`src/server/services/mcp.ts:39`). Both differences could change what the
// client sees, so measure the real pairing: the real `flagRiskPayloadSchema`,
// the real cast, the real mount.
import { defineService, createNodeServer } from "@fcalell/plugin-node/server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { z } from "@fcalell/plugin-api/schema";
import { flagRiskPayloadSchema } from "../../src/server/mcp/schemas.ts";

const PORT = 8799;
const received: string[] = [];

// Verbatim from src/server/mcp/server.ts:14-18.
type RegisterTool = (
	name: string,
	config: { description: string; inputSchema: unknown },
	cb: (args: unknown) => Promise<CallToolResult>,
) => void;

// Verbatim shape of buildMcpServer's loop body, minus the board state: object
// schema in, handler-side safeParse, `isError: true` on refusal.
function buildServer(sessionId: string | undefined): McpServer {
	const mcp = new McpServer({ name: "helm", version: "0.0.0" });
	const register = mcp.registerTool.bind(mcp) as unknown as RegisterTool;
	register(
		"flag_risk",
		{
			description: "Raise a blocking flaw in the brief.",
			inputSchema: flagRiskPayloadSchema,
		},
		async (args) => {
			if (sessionId === undefined) {
				return {
					content: [{ type: "text", text: "session is not initialized yet" }],
					isError: true,
				};
			}
			const parsed = flagRiskPayloadSchema.safeParse(args);
			if (!parsed.success) {
				return {
					content: [{ type: "text", text: z.prettifyError(parsed.error) }],
					isError: true,
				};
			}
			received.push(parsed.data.title);
			return { content: [{ type: "text", text: "Flag recorded." }] };
		},
	);
	return mcp;
}

// Verbatim shape of src/server/services/mcp.ts: hono app, per-request server
// and transport, mounted through the stack's ServiceHttp.
let sessionId: string | undefined = "initialized";
const mcpService = defineService({
	name: "mcp-spike",
	start: (ctx) => {
		const app = new Hono();
		app.all("/mcp/:token", async (c) => {
			if (c.req.param("token") !== "tok") return c.text("unknown MCP token", 404);
			const transport = new StreamableHTTPTransport();
			await buildServer(sessionId).connect(transport);
			return (await transport.handleRequest(c)) ?? c.body(null, 204);
		});
		ctx.http.mount("/mcp", (request) => app.fetch(request));
	},
});

const server = createNodeServer({
	port: PORT,
	worker: null,
	staticRoot: "/nonexistent",
	services: [mcpService],
	log: { info: () => {}, error: (message) => console.error(message) },
});
await server.start();

const client = new Client({ name: "stub-claude", version: "0.0.0" });
await client.connect(
	new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp/tok`)),
);

// (a) Does an object schema survive as a usable JSON schema, or does the SDK
// treat it as a raw shape and enumerate its internals?
const listed = (await client.listTools()).tools[0];
console.log("tools/list name:", listed?.name);
console.log("tools/list inputSchema:", JSON.stringify(listed?.inputSchema));

// (b) A valid call.
const good = await client.callTool({
	name: "flag_risk",
	arguments: { title: "F1", detail: "d" },
});
console.log("valid call:", JSON.stringify(good.content), "isError:", good.isError);

// (c) The load-bearing one: with an object schema, does the SDK still validate
// (a -32602 result) or does the payload reach the handler's own safeParse?
const bad = await client
	.callTool({ name: "flag_risk", arguments: { title: "" } })
	.then(
		(result) =>
			`resolved isError=${String(result.isError)} ${JSON.stringify(result.content).slice(0, 140)}`,
	)
	.catch((error) => `threw: ${String(error).slice(0, 140)}`);
console.log("invalid payload ->", bad);

// (d) The retryable refusal the stub must distinguish, over the same path.
sessionId = undefined;
const notReady = await client.callTool({
	name: "flag_risk",
	arguments: { title: "F2", detail: "d" },
});
console.log(
	"not-ready refusal:",
	JSON.stringify(notReady.content),
	"isError:",
	notReady.isError,
);

// (e) An unknown tool name, the third refusal shape a stub can hit.
const unknown = await client
	.callTool({ name: "no_such_tool", arguments: {} })
	.then((result) => `resolved isError=${String(result.isError)}`)
	.catch((error) => `threw: ${String(error).slice(0, 90)}`);
console.log("unknown tool ->", unknown);

console.log("handler received:", received);
await client.close();
await server.stop();
