import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createStore, reconcile } from "solid-js/store";
import { gateChannel } from "../../shared/channels.ts";
import type {
	GateAttempt,
	GateFlagResolution,
	GateSnapshot,
} from "../../shared/gate.ts";
import { api } from "./api.ts";
import { wsClient } from "./ws.ts";

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
