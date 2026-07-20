import { z } from "@fcalell/plugin-api/schema";
import { sessionKindSchema } from "./kinds.ts";

// Tolerant boundary schema for the CLI's NDJSON stream: the CLI adds event
// types freely across versions, so anything with a `type` passes through and
// the fields the orchestrator acts on are parsed strictly below.
export const sessionEventSchema = z.looseObject({
	type: z.string(),
	subtype: z.string().optional(),
	session_id: z.string().optional(),
});
export type SessionEvent = z.infer<typeof sessionEventSchema>;

const initEventSchema = z.looseObject({
	type: z.literal("system"),
	subtype: z.literal("init"),
	session_id: z.uuid(),
	model: z.string(),
	permissionMode: z.string(),
	tools: z.array(z.string()),
});

export interface SessionInit {
	sessionId: string;
	model: string;
	permissionMode: string;
	tools: string[];
}

export function parseInitEvent(event: SessionEvent): SessionInit | undefined {
	const init = initEventSchema.safeParse(event);
	if (!init.success) return undefined;
	return {
		sessionId: init.data.session_id,
		model: init.data.model,
		permissionMode: init.data.permissionMode,
		tools: init.data.tools,
	};
}

// The CLI's final `result` event: `result` carries the last assistant text
// on success and is absent on the error subtypes (which set `is_error`).
// `usage` counts the turn's non-cache-read tokens (cache reads are priced
// differently, so the sum stays a lower-bound estimate) and `duration_ms`
// the wall clock; both feed the run entry's `tokens`/`minutes`.
const resultEventSchema = z.looseObject({
	type: z.literal("result"),
	subtype: z.string(),
	result: z.string().optional(),
	is_error: z.boolean().optional(),
	duration_ms: z.number().optional(),
	usage: z
		.looseObject({
			input_tokens: z.number().optional(),
			cache_creation_input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
		})
		.optional(),
});

export interface SessionResult {
	text: string;
	isError: boolean;
	tokens?: number;
	minutes?: number;
}

export function parseResultEvent(
	event: SessionEvent,
): SessionResult | undefined {
	const result = resultEventSchema.safeParse(event);
	if (!result.success) return undefined;
	const usage = result.data.usage;
	const tokens =
		usage === undefined
			? undefined
			: (usage.input_tokens ?? 0) +
				(usage.cache_creation_input_tokens ?? 0) +
				(usage.output_tokens ?? 0);
	const duration = result.data.duration_ms;
	return {
		text: result.data.result ?? result.data.subtype,
		isError: result.data.is_error === true || result.data.subtype !== "success",
		tokens,
		minutes:
			duration === undefined ? undefined : Math.round(duration / 6000) / 10,
	};
}

// The CLI's `rate_limit_event`: the payload nests under `rate_limit_info`
// (measured on 2.1.215), with `resetsAt` in unix seconds and `rateLimitType`
// naming the window (`five_hour` observed).
const rateLimitEventSchema = z.looseObject({
	type: z.literal("rate_limit_event"),
	rate_limit_info: z.looseObject({
		status: z.string(),
		resetsAt: z.number(),
		rateLimitType: z.string(),
	}),
});

export interface RateLimitInfo {
	status: string;
	resetsAt: number;
	windowType: string;
}

export function parseRateLimitEvent(
	event: SessionEvent,
): RateLimitInfo | undefined {
	const parsed = rateLimitEventSchema.safeParse(event);
	if (!parsed.success) return undefined;
	const info = parsed.data.rate_limit_info;
	return {
		status: info.status,
		resetsAt: info.resetsAt,
		windowType: info.rateLimitType,
	};
}

// A mid-turn auto-compaction's `system/compact_boundary` event (measured on
// 2.1.215): `compact_metadata` carries the trigger and the pre/post token
// counts the timeline marker shows.
const compactBoundarySchema = z.looseObject({
	type: z.literal("system"),
	subtype: z.literal("compact_boundary"),
	compact_metadata: z.looseObject({
		trigger: z.string(),
		pre_tokens: z.number(),
		post_tokens: z.number(),
	}),
});

export interface CompactBoundary {
	trigger: string;
	preTokens: number;
	postTokens: number;
}

export function parseCompactBoundary(
	event: SessionEvent,
): CompactBoundary | undefined {
	const parsed = compactBoundarySchema.safeParse(event);
	if (!parsed.success) return undefined;
	const meta = parsed.data.compact_metadata;
	return {
		trigger: meta.trigger,
		preTokens: meta.pre_tokens,
		postTokens: meta.post_tokens,
	};
}

// WS envelopes: one `event` per parsed CLI event, one `closed` when the
// process exits. `sessionId` is absent only before `system/init` announces
// it (or when a stale resume dies without one).
export const sessionWireEventSchema = z.object({
	runId: z.uuid(),
	kind: sessionKindSchema,
	sessionId: z.uuid().optional(),
	event: sessionEventSchema,
});
export type SessionWireEvent = z.infer<typeof sessionWireEventSchema>;

export const sessionClosedSchema = z.object({
	runId: z.uuid(),
	kind: sessionKindSchema,
	sessionId: z.uuid().optional(),
	exitCode: z.number().int().nullable(),
	signal: z.string().nullable(),
	stale: z.boolean(),
});
export type SessionClosed = z.infer<typeof sessionClosedSchema>;
