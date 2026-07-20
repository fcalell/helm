// Auto-approves every pending permission for one story: subscribes to the
// proposal channel and resolves each request over run.permission, logging
// what it released. Ctrl-C / task stop ends it.
const storyId = process.argv[2];
if (storyId === undefined) throw new Error("usage: approve-loop.ts <storyId>");
const base = process.argv[3] ?? "http://127.0.0.1:8788";

const seen = new Set<string>();
const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
ws.onopen = () => ws.send(JSON.stringify({ t: "sub", ch: "proposal" }));
ws.onmessage = async (event) => {
	if (typeof event.data !== "string") return;
	const frame = JSON.parse(event.data) as {
		payload?: {
			permissions?: Array<{
				id: string;
				storyId: string;
				toolName: string;
				input: Record<string, unknown>;
			}>;
		};
	};
	for (const request of frame.payload?.permissions ?? []) {
		if (request.storyId !== storyId || seen.has(request.id)) continue;
		seen.add(request.id);
		console.log(
			`${new Date().toISOString()} approving ${request.toolName} ${JSON.stringify(request.input).slice(0, 120)}`,
		);
		await fetch(`${base}/rpc/run/permission`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ json: { id: request.id, approved: true } }),
		});
	}
};
