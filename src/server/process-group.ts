import { setTimeout as delay } from "node:timers/promises";

// Bounded escalation for a run's process group: pid-death alone doesn't quiet
// the tree (a still-running build outlives its `claude` parent), and an
// unbounded wait would let one wedged group stall its caller. Returns whether
// the group is dead; a survivor is the caller's park-Blocked signal.

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
