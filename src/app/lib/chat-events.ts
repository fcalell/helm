import { z } from "@fcalell/plugin-api/schema";
import type { SessionEvent } from "../../sessions/events.ts";

// Boundary schemas for the CLI stream events the chat pane renders. The wire
// schema only guarantees `{ type }`; the fields acted on here are parsed
// strictly and anything else is ignored.

const textBlockSchema = z.looseObject({
	type: z.literal("text"),
	text: z.string(),
});

const toolUseBlockSchema = z.looseObject({
	type: z.literal("tool_use"),
	id: z.string(),
	name: z.string(),
	input: z.unknown(),
});

const contentBlockSchema = z.discriminatedUnion("type", [
	textBlockSchema,
	toolUseBlockSchema,
]);

const toolResultBlockSchema = z.looseObject({
	type: z.literal("tool_result"),
	tool_use_id: z.string(),
	content: z
		.union([z.string(), z.array(z.looseObject({ type: z.string() }))])
		.optional(),
	is_error: z.boolean().optional(),
});

// The SSE payload kinds the pane acts on; every other stream event fails this
// parse and is ignored.
const streamPayloadSchema = z.discriminatedUnion("type", [
	z.looseObject({ type: z.literal("message_start") }),
	z.looseObject({
		type: z.literal("content_block_start"),
		index: z.number().int(),
		content_block: z.unknown(),
	}),
	z.looseObject({
		type: z.literal("content_block_delta"),
		index: z.number().int(),
		delta: z.looseObject({
			type: z.string(),
			text: z.string().optional(),
		}),
	}),
]);

const streamEventSchema = z.looseObject({
	type: z.literal("stream_event"),
	event: streamPayloadSchema,
});

const assistantEventSchema = z.looseObject({
	type: z.literal("assistant"),
	message: z.looseObject({ content: z.array(z.unknown()) }),
});

const userEventSchema = z.looseObject({
	type: z.literal("user"),
	message: z.looseObject({
		content: z.union([z.string(), z.array(z.unknown())]),
	}),
});

export type StreamPayload = z.infer<typeof streamPayloadSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type ToolUseBlock = z.infer<typeof toolUseBlockSchema>;
export type ToolResultBlock = z.infer<typeof toolResultBlockSchema>;

export function parseStreamEvent(
	event: SessionEvent,
): StreamPayload | undefined {
	const parsed = streamEventSchema.safeParse(event);
	return parsed.success ? parsed.data.event : undefined;
}

// Text or tool_use; thinking and future block kinds return undefined.
export function parseContentBlock(block: unknown): ContentBlock | undefined {
	const parsed = contentBlockSchema.safeParse(block);
	return parsed.success ? parsed.data : undefined;
}

export function parseAssistantEvent(
	event: SessionEvent,
): ContentBlock[] | undefined {
	const parsed = assistantEventSchema.safeParse(event);
	if (!parsed.success) return undefined;
	return parsed.data.message.content
		.map(parseContentBlock)
		.filter((block) => block !== undefined);
}

export interface UserEventContent {
	texts: string[];
	toolResults: ToolResultBlock[];
}

export function parseUserEvent(
	event: SessionEvent,
): UserEventContent | undefined {
	const parsed = userEventSchema.safeParse(event);
	if (!parsed.success) return undefined;
	const content = parsed.data.message.content;
	if (typeof content === "string") {
		return { texts: [content], toolResults: [] };
	}
	const texts: string[] = [];
	const toolResults: ToolResultBlock[] = [];
	for (const block of content) {
		const text = textBlockSchema.safeParse(block);
		if (text.success) {
			texts.push(text.data.text);
			continue;
		}
		const result = toolResultBlockSchema.safeParse(block);
		if (result.success) toolResults.push(result.data);
	}
	return { texts, toolResults };
}

// Tool results are plain text; the ids in them anchor a tool call to the
// proposal/question it recorded (see `src/server/mcp/tools.ts`).
const UUID_SOURCE = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const PROPOSAL_RE = new RegExp(`Recorded proposal (${UUID_SOURCE})`);
const QUESTION_RE = new RegExp(`Recorded question (${UUID_SOURCE})`);

export function toolResultText(block: ToolResultBlock): string {
	if (typeof block.content === "string") return block.content;
	if (block.content === undefined) return "";
	return block.content
		.map((each) => {
			const text = textBlockSchema.safeParse(each);
			return text.success ? text.data.text : undefined;
		})
		.filter((each) => each !== undefined)
		.join("\n");
}

export function extractProposalId(text: string): string | undefined {
	return PROPOSAL_RE.exec(text)?.[1];
}

export function extractQuestionId(text: string): string | undefined {
	return QUESTION_RE.exec(text)?.[1];
}
