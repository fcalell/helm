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
const resultEventSchema = z.looseObject({
	type: z.literal("result"),
	subtype: z.string(),
	result: z.string().optional(),
	is_error: z.boolean().optional(),
});

export interface SessionResult {
	text: string;
	isError: boolean;
}

export function parseResultEvent(
	event: SessionEvent,
): SessionResult | undefined {
	const result = resultEventSchema.safeParse(event);
	if (!result.success) return undefined;
	return {
		text: result.data.result ?? result.data.subtype,
		isError: result.data.is_error === true || result.data.subtype !== "success",
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
