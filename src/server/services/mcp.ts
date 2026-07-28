import { defineService } from "@fcalell/plugin-node/server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { lookupSpawn, setMcpPort } from "../mcp/registry.ts";
import { buildMcpServer } from "../mcp/server.ts";
import { runCompactHook, runHookPosted } from "./runs.ts";

// Hosts the orchestrator's board-tools MCP server. Each spawn reaches its own
// `/mcp/<token>` endpoint (per-spawn URL in `--mcp-config`), so a tool call
// resolves to its binding server-side. Fresh server + transport per request,
// the spike-verified stateless pattern. The run's token-addressed hook
// endpoints (Stop, PreCompact) mount beside it.
export default defineService({
	name: "mcp",
	start: (ctx) => {
		setMcpPort(ctx.http.port);
		const app = new Hono();
		app.all("/mcp/:token", async (c) => {
			const binding = lookupSpawn(c.req.param("token"));
			if (binding === undefined) return c.text("unknown MCP token", 404);
			const transport = new StreamableHTTPTransport();
			await buildMcpServer(binding).connect(transport);
			// handleRequest is typed `Response | undefined`; every branch returns a
			// Response in practice, so the 204 is a defensive fallback.
			return (await transport.handleRequest(c)) ?? c.body(null, 204);
		});
		app.post("/hooks/run/:token", (c) =>
			runHookPosted(c.req.param("token"))
				? c.body(null, 204)
				: c.text("unknown run token", 404),
		);
		app.post("/hooks/compact/:token", async (c) => {
			const decision = await runCompactHook(c.req.param("token"));
			return decision === undefined
				? c.text("unknown run token", 404)
				: c.json(decision);
		});
		ctx.http.mount("/mcp", (request) => app.fetch(request));
		ctx.http.mount("/hooks", (request) => app.fetch(request));
	},
});
