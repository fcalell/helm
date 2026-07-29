// Unknown 2: an orchestrator started from a scratch cwd reads a scratch
// `helm.config.json` (`src/server/config.ts:20,26`) but loses the SPA, because
// `.stack/server.ts` hardcodes `staticRoot: "dist/client"` and
// `serveStatic({ root })` resolves it from the process cwd
// (`../stack/plugins/node/src/server/create-node-server.ts:53,115`). Does a
// symlink from the scratch cwd to the repo's built client restore it?
// Resolved from the sibling stack repo: @hono/node-server is the stack's dep,
// not Helm's, and this spike only needs the same serveStatic the server uses.
import { serveStatic } from "/Users/fcalell/projects/stack/node_modules/.pnpm/@hono+node-server@2.0.9_hono@4.12.23/node_modules/@hono/node-server/dist/serve-static.mjs";
import { Hono } from "hono";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const SCRATCH = "/tmp/helm-harness-spike";
const CLIENT = `${SCRATCH}/dist/client`;
const REAL = `${SCRATCH}/real-client`;

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(`${SCRATCH}/dist`, { recursive: true });
mkdirSync(REAL, { recursive: true });
writeFileSync(`${REAL}/index.html`, "<!doctype html><title>scratch spa</title>");
writeFileSync(
	`${SCRATCH}/helm.config.json`,
	JSON.stringify({ repos: [{ path: `${SCRATCH}/repo`, mainBranch: "master" }] }),
);
// The candidate fix: dist/client in the scratch cwd is a symlink to the repo's.
symlinkSync(REAL, CLIENT, "dir");

process.chdir(SCRATCH);
console.log("cwd:", process.cwd());

// Config half: read exactly as loadManagedRepo does, from the new cwd.
const { readFile } = await import("node:fs/promises");
console.log("helm.config.json from cwd:", (await readFile("helm.config.json", "utf8")).slice(0, 80));

// Static half: serveStatic with the hardcoded relative root, through the symlink.
const app = new Hono();
app.use("*", serveStatic({ root: "dist/client" }));
app.get("*", serveStatic({ path: "dist/client/index.html" }));

const httpServer = createServer((req, res) => {
	void app
		.fetch(new Request(`http://127.0.0.1${req.url ?? "/"}`))
		.then(async (response) => {
			res.writeHead(response.status);
			res.end(Buffer.from(await response.arrayBuffer()));
		});
});
await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const address = httpServer.address();
if (address === null || typeof address === "string") throw new Error("no port");

const index = await fetch(`http://127.0.0.1:${address.port}/`);
console.log("GET / ->", index.status, (await index.text()).slice(0, 60));
httpServer.close();
