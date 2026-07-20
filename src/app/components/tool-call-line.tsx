import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { createSignal, Show } from "solid-js";
import { MCP_SERVER_NAME } from "../../sessions/kinds.ts";
import type { ChatItem } from "../lib/session-store.ts";

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
	const [expanded, setExpanded] = createSignal(false);
	const name = () => props.item.name.replace(BOARD_TOOL_PREFIX, "");
	return (
		<div class="rounded-md border border-transparent text-xs">
			<button
				type="button"
				class={cn(
					"flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left font-mono text-muted-foreground hover:bg-accent hover:text-accent-foreground",
					props.item.isError && "text-destructive",
				)}
				onClick={() => setExpanded((value) => !value)}
			>
				<span class="select-none">{expanded() ? "▾" : "▸"}</span>
				<span class="truncate">
					{name()}({summarizeInput(props.item.input)})
					{props.item.done ? "" : " …"}
				</span>
			</button>
			<Show when={expanded()}>
				<div class="ml-4 mt-1 flex flex-col gap-1 border-l pl-2">
					<pre class="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
						{JSON.stringify(props.item.input ?? {}, null, 2)}
					</pre>
					<Show when={props.item.result}>
						{(result) => (
							<pre
								class={cn(
									"max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground",
									props.item.isError && "text-destructive",
								)}
							>
								{result()}
							</pre>
						)}
					</Show>
				</div>
			</Show>
		</div>
	);
}
