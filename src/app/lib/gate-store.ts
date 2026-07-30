import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createStore, reconcile } from "solid-js/store";
import { gateChannel } from "../../shared/channels.ts";
import type {
	GateAttempt,
	GateFlagResolution,
	GatePhase,
	GateSnapshot,
} from "../../shared/gate.ts";
import { api } from "./api.ts";
import { wsClient } from "./ws.ts";

// The single phase -> copy source: the gate panel renders it, and the move
// toast reuses it when a drag into Ready comes back gating.
export const PHASE_LINES: Record<GatePhase, string> = {
	queued: "Adversary review queued",
	adversary: "Adversary review running",
	refine: "Refine chat is answering the adversary's flags",
	review: "Contested flags await your call",
	exhausted: "The automatic rounds are spent; the gate waits for you",
};

interface GateState {
	// Active ready-gate attempts keyed by story id.
	attempts: Record<string, GateAttempt>;
}

const [store, setStore] = createStore<GateState>({ attempts: {} });

function applySnapshot(snapshot: GateSnapshot): void {
	const attempts: Record<string, GateAttempt> = {};
	for (const attempt of snapshot.attempts) {
		attempts[attempt.storyId] = attempt;
	}
	setStore("attempts", reconcile(attempts));
}

let started = false;

export function connectGate(): void {
	if (started) return;
	started = true;
	wsClient().subscribe(gateChannel, {
		onMessage: { snapshot: applySnapshot },
	});
}

export function gateFor(storyId: string): GateAttempt | undefined {
	return store.attempts[storyId];
}

export async function resolveGateFlag(
	storyId: string,
	flag: string,
	resolution: GateFlagResolution,
): Promise<void> {
	try {
		await api.gate.resolveFlag({ storyId, flag, resolution });
	} catch (error) {
		toast.error(
			error instanceof Error ? error.message : "failed to resolve the flag",
		);
		throw error;
	}
}
