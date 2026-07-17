import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import {
	createEffect,
	createSignal,
	For,
	type JSX,
	Match,
	Show,
	Switch,
} from "solid-js";
import { MCP_SERVER_NAME } from "../../sessions/kinds.ts";
import {
	type ChatItem,
	chatFor,
	sendChatMessage,
	sessionStore,
	unanchoredProposals,
	unanchoredQuestions,
} from "../lib/session-store.ts";
import { ProposalWidget } from "./proposal-widget.tsx";
import { QuestionWidget } from "./question-widget.tsx";

const BOARD_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

function summarizeInput(input: unknown): string {
	if (input === undefined || input === null) return "";
	if (typeof input !== "object") return String(input);
	const first = Object.values(input)[0];
	const text = typeof first === "string" ? first : JSON.stringify(first);
	if (text === undefined) return "";
	return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function ToolCallLine(props: { item: Extract<ChatItem, { type: "tool" }> }) {
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

function ToolItem(props: { item: Extract<ChatItem, { type: "tool" }> }) {
	const proposal = () => {
		const id = props.item.proposalId;
		return id === undefined ? undefined : sessionStore.proposals[id];
	};
	const question = () => {
		const id = props.item.questionId;
		return id === undefined ? undefined : sessionStore.questions[id];
	};
	return (
		<Switch fallback={<ToolCallLine item={props.item} />}>
			<Match when={proposal()}>
				{(logged) => <ProposalWidget proposal={logged()} />}
			</Match>
			<Match when={question()}>
				{(logged) => <QuestionWidget question={logged()} />}
			</Match>
		</Switch>
	);
}

function asType<T extends ChatItem["type"]>(
	item: ChatItem,
	type: T,
): Extract<ChatItem, { type: T }> | false {
	return item.type === type ? (item as Extract<ChatItem, { type: T }>) : false;
}

function TranscriptItem(props: { item: ChatItem }) {
	return (
		<Switch>
			<Match when={asType(props.item, "user")}>
				{(item) => (
					<div class="ml-8 self-end whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-sm">
						{item().text}
					</div>
				)}
			</Match>
			<Match when={asType(props.item, "assistant")}>
				{(item) => (
					<Show when={item().text !== ""}>
						<div class="whitespace-pre-wrap text-sm">{item().text}</div>
					</Show>
				)}
			</Match>
			<Match when={asType(props.item, "tool")}>
				{(item) => <ToolItem item={item()} />}
			</Match>
		</Switch>
	);
}

export interface ChatPaneProps {
	sessionId: string;
	// The artifact-under-construction slot the chat stories fill.
	artifact?: JSX.Element;
}

export function ChatPane(props: ChatPaneProps) {
	const chat = () => chatFor(props.sessionId);
	const [draft, setDraft] = createSignal("");
	let transcriptRef: HTMLDivElement | undefined;

	createEffect(() => {
		// Track everything that grows the transcript — including the streaming
		// tail's text, which mutates without changing the item count — then pin
		// to the bottom.
		const items = chat().items;
		const last = items[items.length - 1];
		if (last?.type === "assistant") last.text;
		if (last?.type === "tool") last.done;
		chat().busy;
		if (transcriptRef !== undefined) {
			transcriptRef.scrollTop = transcriptRef.scrollHeight;
		}
	});

	function send(): void {
		const text = draft().trim();
		if (text === "" || chat().busy) return;
		setDraft("");
		void sendChatMessage(props.sessionId, text);
	}

	return (
		<div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
			<div class="shrink-0 rounded-lg border bg-card p-3">
				<h3 class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
					Artifact
				</h3>
				<div class="mt-1 text-sm text-muted-foreground">
					{props.artifact ?? <p>Nothing under construction yet.</p>}
				</div>
			</div>
			<div
				ref={transcriptRef}
				class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
			>
				<For each={chat().items}>
					{(item) => <TranscriptItem item={item} />}
				</For>
				<For each={unanchoredProposals(props.sessionId, chat().items)}>
					{(proposal) => <ProposalWidget proposal={proposal} />}
				</For>
				<For each={unanchoredQuestions(props.sessionId, chat().items)}>
					{(question) => <QuestionWidget question={question} />}
				</For>
				<Show when={chat().busy}>
					<Loader text="assistant is working" class="text-xs" />
				</Show>
			</div>
			<form
				class="flex shrink-0 items-end gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					send();
				}}
			>
				<Textarea
					size="sm"
					rows={2}
					value={draft()}
					onInput={(event) => setDraft(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							send();
						}
					}}
					placeholder={
						chat().busy ? "Waiting for the assistant…" : "Message the chat…"
					}
					aria-label="Chat message"
				/>
				<Button type="submit" size="sm" disabled={chat().busy}>
					Send
				</Button>
			</form>
		</div>
	);
}
