import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HELM_REPO, type Scratch, STUB_DIR } from "./scratch.ts";

// Build outputs, none of them committed: without all three the orchestrator
// serves a dangling symlink or fails to boot.
const BUILD_OUTPUTS = [
	"dist/client",
	".stack/worker.ts",
	".stack/procedure.ts",
];

export const BUILD_INSTRUCTION =
	"run `pnpm generate && pnpm build` (stack generate && stack build) in the helm repo first";

export function missingBuildOutputs(): string[] {
	return BUILD_OUTPUTS.filter((path) => !existsSync(join(HELM_REPO, path)));
}

export interface Orchestrator {
	base: string;
	stop(): Promise<void>;
}

const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startOrchestrator(
	scratch: Scratch,
	port: number,
): Promise<Orchestrator> {
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(
		"node",
		[fileURLToPath(new URL("./entry.ts", import.meta.url))],
		{
			cwd: scratch.root,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				HELM_HARNESS_PORT: String(port),
				HELM_STUB_SCRIPTS: scratch.scriptsDir,
				HELM_STUB_LOG: scratch.logPath,
				// The one mechanism that makes `spawn("claude", …)` find the stub.
				PATH: `${STUB_DIR}:${process.env.PATH ?? ""}`,
			},
		},
	);
	const echo = (chunk: Buffer): void => {
		for (const line of chunk.toString().trimEnd().split("\n")) {
			console.log(`  [server] ${line}`);
		}
	};
	child.stdout.on("data", echo);
	child.stderr.on("data", echo);

	const deadline = Date.now() + READY_TIMEOUT_MS;
	for (;;) {
		if (child.exitCode !== null) {
			throw new Error(`the scratch orchestrator exited (${child.exitCode})`);
		}
		try {
			const response = await fetch(base);
			if (response.ok) break;
		} catch {
			// not listening yet
		}
		if (Date.now() > deadline) {
			child.kill("SIGKILL");
			throw new Error(`the scratch orchestrator never listened on ${base}`);
		}
		await sleep(200);
	}

	return {
		base,
		async stop() {
			if (child.exitCode !== null) return;
			child.kill("SIGTERM");
			const deadline = Date.now() + STOP_TIMEOUT_MS;
			while (child.exitCode === null && Date.now() < deadline) {
				await sleep(100);
			}
			if (child.exitCode === null) child.kill("SIGKILL");
		},
	};
}
