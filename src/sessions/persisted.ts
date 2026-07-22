import { z } from "@fcalell/plugin-api/schema";

// The `claude` CLI's persisted transcript is JSONL, one line per event, and
// differs from the live WS wire format: the envelope is camelCase and the CLI
// writes many line types the chat pane never renders. This schema is tolerant
// (the CLI adds types and fields freely across versions): only the fields the
// rehydration reducer acts on are parsed, and any line whose `type` is outside
// the kept set is dropped by `readTranscript` before it reaches here.
//
// Kept lines: `user`/`assistant` (message content, string or Anthropic block
// array) and `system` with `subtype: "compact_boundary"`. `message.content`
// blocks share the wire block shapes (`text`/`tool_use`/`tool_result`), so the
// client's per-block handling transfers.

const messageSchema = z.looseObject({
	content: z.union([z.string(), z.array(z.unknown())]),
});

export const persistedLineSchema = z.discriminatedUnion("type", [
	z.looseObject({
		type: z.literal("user"),
		message: messageSchema,
		isMeta: z.boolean().optional(),
		isSidechain: z.boolean().optional(),
		isCompactSummary: z.boolean().optional(),
	}),
	z.looseObject({
		type: z.literal("assistant"),
		message: messageSchema,
		isMeta: z.boolean().optional(),
		isSidechain: z.boolean().optional(),
	}),
	// A persisted compact boundary carries no postTokens (unlike the live wire
	// event), so the hydrated compact item treats it as optional.
	z.looseObject({
		type: z.literal("system"),
		subtype: z.literal("compact_boundary"),
		compactMetadata: z.looseObject({
			trigger: z.string(),
			preTokens: z.number().optional(),
			postTokens: z.number().optional(),
		}),
	}),
]);
export type PersistedLine = z.infer<typeof persistedLineSchema>;
