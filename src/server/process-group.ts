import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// pid-death alone doesn't quiet the tree: a still-running build subprocess
// outlives its `claude` parent. Returns false if the group survived SIGKILL.

const SIGTERM_WAIT_MS = 5000;
const SIGKILL_WAIT_MS = 2000;
const POLL_MS = 200;

export function groupAlive(pid: number): boolean {
	try {
		process.kill(-pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForDeath(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!groupAlive(pid)) return true;
		await delay(POLL_MS);
	}
	return !groupAlive(pid);
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal);
	} catch {
		// The group died between the check and the signal.
	}
}

export async function killProcessGroup(pid: number): Promise<boolean> {
	if (!groupAlive(pid)) return true;
	signalGroup(pid, "SIGTERM");
	if (await waitForDeath(pid, SIGTERM_WAIT_MS)) return true;
	signalGroup(pid, "SIGKILL");
	return waitForDeath(pid, SIGKILL_WAIT_MS);
}

// Interleaved stdout+stderr, capped to the tail.
const OUTPUT_CAP = 16_000;

export interface ShellResult {
	// null when the command timed out or failed to spawn.
	exitCode: number | null;
	output: string;
}

// Runs a shell command detached, so a timeout kills the whole group. Never
// rejects: a spawn failure resolves with `exitCode: null` and the error text
// in the output.
export function runShellCommand(
	command: string,
	cwd: string,
	timeoutMs: number,
): Promise<ShellResult> {
	return new Promise((resolve) => {
		const child = spawn(command, {
			cwd,
			shell: true,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		let timedOut = false;
		const append = (chunk: Buffer): void => {
			output = (output + chunk.toString()).slice(-OUTPUT_CAP);
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		const timer = setTimeout(() => {
			timedOut = true;
			if (child.pid !== undefined) void killProcessGroup(child.pid);
		}, timeoutMs);
		let settled = false;
		const settle = (exitCode: number | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ exitCode: timedOut ? null : exitCode, output });
		};
		child.on("error", (error) => {
			append(Buffer.from(String(error)));
			settle(null);
		});
		child.on("close", (code) => settle(code));
	});
}
