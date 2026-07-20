import { createStore } from "solid-js/store";
import { meterChannel } from "../../shared/channels.ts";
import type { MeterSnapshot } from "../../shared/meter.ts";
import { wsClient } from "./ws.ts";

interface MeterState {
	// The latest server snapshot; undefined until the first frame arrives.
	snapshot: MeterSnapshot | undefined;
}

const [store, setStore] = createStore<MeterState>({ snapshot: undefined });

export const meterStore = store;

let started = false;

export function connectMeter(): void {
	if (started) return;
	started = true;
	wsClient().subscribe(meterChannel, {
		onMessage: { snapshot: (snapshot) => setStore("snapshot", snapshot) },
	});
}
