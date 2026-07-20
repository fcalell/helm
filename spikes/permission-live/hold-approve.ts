// The hold measurement: sleeps past the CLI's default 5-minute MCP window,
// approves the named held permission, then auto-approves any later prompt
// for the story so the run finishes.
import { execFileSync } from "node:child_process";

const [, , id, storyId, holdMsArg] = process.argv;
if (id === undefined || storyId === undefined) {
	throw new Error("usage: hold-approve.ts <permissionId> <storyId> [holdMs]");
}
const holdMs = Number(holdMsArg ?? 390_000);

console.log(`${new Date().toISOString()} holding ${id} for ${holdMs}ms`);
await new Promise((resolve) => setTimeout(resolve, holdMs));
const response = await fetch("http://127.0.0.1:8788/rpc/run/permission", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ json: { id, approved: true } }),
});
console.log(
	`${new Date().toISOString()} approved after hold: HTTP ${response.status} ${await response.text()}`,
);

execFileSync(
	"node",
	[new URL("./approve-loop.ts", import.meta.url).pathname, storyId],
	{ stdio: "inherit", timeout: 180_000 },
);
