// Subscribes to the orchestrator's WS channels and appends every frame to a
// log file with a timestamp, so the spike can observe pending permissions,
// session streams, and board flips from the shell.
const url = process.argv[2] ?? "ws://127.0.0.1:8788/ws";
const ws = new WebSocket(url);
ws.onopen = () => {
	for (const ch of ["proposal", "session", "board", "gate"]) {
		ws.send(JSON.stringify({ t: "sub", ch }));
	}
	console.log(JSON.stringify({ ts: new Date().toISOString(), open: true }));
};
ws.onmessage = (event) => {
	console.log(
		`${new Date().toISOString()} ${typeof event.data === "string" ? event.data : "<binary>"}`,
	);
};
ws.onclose = () => {
	console.log(JSON.stringify({ ts: new Date().toISOString(), closed: true }));
	process.exit(0);
};
ws.onerror = () => {
	console.error("ws error");
};
