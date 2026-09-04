import { Prose } from "@fcalell/plugin-solid-ui/components/prose";
import { ScrollArea } from "@fcalell/plugin-solid-ui/components/scroll-area";
import { Stack } from "@fcalell/plugin-solid-ui/components/stack";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import {
	createEffect,
	createSignal,
	For,
	type JSX,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import { formatTokens } from "../lib/format.ts";
import { type ChatItem, chatFor } from "../lib/session-store.ts";
import { Bubble } from "../ui/bubble.tsx";
import { ScrollToBottom } from "../ui/scroll-to-bottom.tsx";

// How far from the pane's end still counts as the end, matching the canon's
// own pin threshold so the control and the pin agree on one boundary.
const END_MARGIN = 40;

function asType<T extends ChatItem["type"]>(
	item: ChatItem,
	type: T,
): Extract<ChatItem, { type: T }> | false {
	return item.type === type ? (item as Extract<ChatItem, { type: T }>) : false;
}

export type ToolRenderer = (
	item: Extract<ChatItem, { type: "tool" }>,
) => JSX.Element;

function TranscriptItem(props: {
	item: ChatItem;
	renderTool: ToolRenderer;
	onUser: (element: HTMLDivElement) => void;
}) {
	return (
		<Switch>
			<Match when={asType(props.item, "user")}>
				{(item) => <Bubble ref={props.onUser}>{item().text}</Bubble>}
			</Match>
			<Match when={asType(props.item, "assistant")}>
				{(item) => (
					<Show when={item().text !== ""}>
						<Prose markdown={item().text} />
					</Show>
				)}
			</Match>
			<Match when={asType(props.item, "compact")}>
				{(item) => (
					<Text variant="micro" tone="ink-3">
						Context compacted ({item().trigger}) ·{" "}
						{formatTokens(item().preTokens)} → {formatTokens(item().postTokens)}
					</Text>
				)}
			</Match>
			<Match when={asType(props.item, "tool")}>
				{(item) => props.renderTool(item())}
			</Match>
		</Switch>
	);
}

export interface ConversationProps {
	sessionId: string;
	// The surface's own reading of a tool call: a widget in a chat, a diff in
	// a run timeline.
	renderTool: ToolRenderer;
	// Rendered below the items, inside the scroll region: pending widgets, the
	// busy loader, a paused line.
	children?: JSX.Element;
}

// One transcript for every surface. It owns the scroll region and the item
// switch; the surfaces above it own their composer, their controls and their
// reading of a tool call.
export function Conversation(props: ConversationProps) {
	const chat = () => chatFor(props.sessionId);
	const [atEnd, setAtEnd] = createSignal(true);
	// Present from the send until the turn closes, so the newest message can
	// reach the top of the pane and a finished turn still leaves no gap.
	const [spacing, setSpacing] = createSignal(false);
	const userElements = new Map<number, HTMLDivElement>();
	let sentinel!: HTMLDivElement;

	// The sentinel sits after the spacer, so a spacer that is merely present
	// never reads as being at the end. `IntersectionObserver` intersects with
	// every clipping ancestor, so a null root still answers for the pane.
	onMount(() => {
		const observer = new IntersectionObserver(
			([entry]) => setAtEnd(entry?.isIntersecting === true),
			{ rootMargin: `0px 0px ${END_MARGIN}px 0px` },
		);
		observer.observe(sentinel);
		onCleanup(() => observer.disconnect());
	});

	let anchored = -1;
	createEffect(() => {
		const at = chat().items.findLastIndex((item) => item.type === "user");
		if (at === anchored || at === -1) return;
		anchored = at;
		setSpacing(true);
		// The spacer has to be laid out before the anchor can scroll onto it.
		queueMicrotask(() =>
			userElements.get(at)?.scrollIntoView({ block: "start" }),
		);
	});

	createEffect(() => {
		if (!chat().busy) setSpacing(false);
	});

	return (
		<>
			<ScrollArea pinToBottom>
				<Stack>
					<For each={chat().items}>
						{(item, index) => (
							<TranscriptItem
								item={item}
								renderTool={props.renderTool}
								onUser={(element) => userElements.set(index(), element)}
							/>
						)}
					</For>
					{props.children}
				</Stack>
				<Show when={spacing()}>
					{/* A pane's height puts the anchor at the pane's top; the margin
					    on top of it keeps the anchored position clear of the pin
					    threshold, which at exactly a pane's height still reads as
					    the end and pins the reply back to the bottom. */}
					<div style={{ height: `calc(100% + ${END_MARGIN}px)` }} />
				</Show>
				{/* A zero-height target has a zero-area intersection rectangle, which
				    never reports as intersecting, so the end marker needs a line of
				    its own to be observable. */}
				<div ref={sentinel} style={{ height: "1px" }} />
			</ScrollArea>
			<Show when={!atEnd()}>
				<ScrollToBottom
					onClick={() => sentinel.scrollIntoView({ block: "end" })}
				/>
			</Show>
		</>
	);
}
