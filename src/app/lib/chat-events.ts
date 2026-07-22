import { z } from "@fcalell/plugin-api/schema";
import type { SessionEvent } from "../../sessions/events.ts";
import type { PersistedLine } from "../../sessions/persisted.ts";
import type { ChatItem } from "./session-store.ts";

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

// Rehydration: reduce the CLI's persisted transcript lines into the same
// ChatItems the live stream produces. Shares the per-block parsing above, so an
// item hydrated from disk is indistinguishable from one built live.
export function reduceTranscript(lines: PersistedLine[]): ChatItem[] {
	const items: ChatItem[] = [];
	const toolIndex = new Map<string, number>();
	for (const line of lines) {
		if (line.type === "system") {
			const meta = line.compactMetadata;
			items.push({
				type: "compact",
				trigger: meta.trigger,
				preTokens: meta.preTokens ?? 0,
				postTokens: meta.postTokens ?? 0,
			});
			continue;
		}
		const content = line.message.content;
		if (typeof content === "string") {
			if (line.type === "user" && content.trim() !== "") {
				items.push({ type: "user", text: content });
			}
			continue;
		}
		for (const block of content) {
			if (line.type === "assistant") {
				reduceAssistantBlock(items, toolIndex, block);
			} else {
				reduceUserBlock(items, toolIndex, block);
			}
		}
	}
	// A tool_use with no persisted tool_result (the turn was cut off) still
	// renders as a finished line.
	for (const item of items) {
		if (item.type === "tool") item.done = true;
	}
	return items;
}

function reduceAssistantBlock(
	items: ChatItem[],
	toolIndex: Map<string, number>,
	block: unknown,
): void {
	const parsed = parseContentBlock(block);
	if (parsed === undefined) return;
	if (parsed.type === "text") {
		if (parsed.text.trim() !== "") {
			items.push({ type: "assistant", text: parsed.text, done: true });
		}
		return;
	}
	toolIndex.set(parsed.id, items.length);
	items.push({
		type: "tool",
		toolUseId: parsed.id,
		name: parsed.name,
		input: parsed.input,
		done: false,
	});
}

function reduceUserBlock(
	items: ChatItem[],
	toolIndex: Map<string, number>,
	block: unknown,
): void {
	const text = textBlockSchema.safeParse(block);
	if (text.success) {
		if (text.data.text.trim() !== "") {
			items.push({ type: "user", text: text.data.text });
		}
		return;
	}
	const result = toolResultBlockSchema.safeParse(block);
	if (!result.success) return;
	const index = toolIndex.get(result.data.tool_use_id);
	if (index === undefined) return;
	const item = items[index];
	if (item?.type !== "tool") return;
	const resultText = toolResultText(result.data);
	item.result = resultText;
	item.isError = result.data.is_error ?? false;
	item.done = true;
	if (item.isError) return;
	item.proposalId = extractProposalId(resultText);
	item.questionId = extractQuestionId(resultText);
}
