import { type ChannelHandle, defineService } from "@fcalell/plugin-node/server";
import {
	parseRateLimitEvent,
	parseResultEvent,
} from "../../sessions/events.ts";
import { meterChannel } from "../../shared/channels.ts";
import type { MeterSnapshot, MeterWindow } from "../../shared/meter.ts";
import { onQueueChange, queueSnapshot } from "../dispatcher.ts";
import { onSessionEvent, type SessionEventInfo } from "./sessions.ts";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Collapse a burst of events into one broadcast (the board pattern).
const BROADCAST_DEBOUNCE_MS = 100;

// In-memory only: the meter is a lower bound (other machines are invisible),
// so a restart's loss only widens the underestimate and nothing persists.
const windows = new Map<string, MeterWindow>();
let samples: { at: number; tokens: number }[] = [];
let handle: ChannelHandle<(typeof meterChannel)["server"]> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function sumSince(start: number): number {
	return samples.reduce(
		(sum, sample) => (sample.at >= start ? sum + sample.tokens : sum),
		0,
	);
}

function snapshot(): MeterSnapshot {
	const now = Date.now();
	samples = samples.filter((sample) => now - sample.at <= WEEK_MS);
	// A reset still ahead anchors the window start; a stale one means the
	// window rolled with no session since, so fall back to the trailing 5h.
	const reset = windows.get("five_hour");
	const windowStart =
		reset !== undefined && reset.resetsAt * 1000 > now
			? reset.resetsAt * 1000 - FIVE_HOURS_MS
			: now - FIVE_HOURS_MS;
	return {
		queue: queueSnapshot(),
		windows: [...windows.values()],
		tokens: { fiveHour: sumSince(windowStart), week: sumSince(now - WEEK_MS) },
	};
}

function scheduleBroadcast(): void {
	if (timer !== undefined) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = undefined;
		handle?.broadcast("snapshot", snapshot());
	}, BROADCAST_DEBOUNCE_MS);
}

function onEvent({ event }: SessionEventInfo): void {
	const limit = parseRateLimitEvent(event);
	if (limit !== undefined) {
		windows.set(limit.windowType, {
			windowType: limit.windowType,
			status: limit.status,
			resetsAt: limit.resetsAt,
		});
		scheduleBroadcast();
		return;
	}
	if (event.type !== "result") return;
	const tokens = parseResultEvent(event)?.tokens;
	if (tokens === undefined) return;
	samples.push({ at: Date.now(), tokens });
	scheduleBroadcast();
}

export default defineService({
	name: "meter",
	start: (ctx) => {
		handle = ctx.ws.channel(meterChannel, {
			onSubscribe: (conn) => {
				conn.send("snapshot", snapshot());
			},
		});
		onQueueChange(scheduleBroadcast);
		onSessionEvent(onEvent);
		return () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			handle = undefined;
			windows.clear();
			samples = [];
		};
	},
});
