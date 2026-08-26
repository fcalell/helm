import { Show } from "solid-js";
import { MCP_SERVER_NAME } from "../../sessions/kinds.ts";
import type { ChatItem } from "../lib/session-store.ts";
import { CodeBlock } from "../ui/code-block.tsx";
import { Disclosure } from "../ui/disclosure.tsx";

const BOARD_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

export type ToolChatItem = Extract<ChatItem, { type: "tool" }>;

function summarizeInput(input: unknown): string {
	if (input === undefined || input === null) return "";
	if (typeof input !== "object") return String(input);
	const first = Object.values(input)[0];
	const text = typeof first === "string" ? first : JSON.stringify(first);
	if (text === undefined) return "";
	return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function ToolCallLine(props: { item: ToolChatItem }) {
	const name = () => props.item.name.replace(BOARD_TOOL_PREFIX, "");
	return (
		<Disclosure
			bordered={false}
			tone={props.item.isError ? "danger" : "ink-3"}
			summary={
				<>
					{name()}({summarizeInput(props.item.input)})
					{props.item.done ? "" : " …"}
				</>
			}
		>
			<div class="flex flex-col gap-pair">
				<CodeBlock>{JSON.stringify(props.item.input ?? {}, null, 2)}</CodeBlock>
				<Show when={props.item.result}>
					{(result) => (
						<CodeBlock cap="sm" tone={props.item.isError ? "danger" : "ink-3"}>
							{result()}
						</CodeBlock>
					)}
				</Show>
			</div>
		</Disclosure>
	);
}
