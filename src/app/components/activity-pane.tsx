import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import { briefHash } from "../../board/hash.ts";
import type { Run, Story } from "../../board/schema.ts";
import { formatTokens } from "../lib/format.ts";
import {
	type ChatItem,
	chatFor,
	pauseRun,
	steerRun,
	stopRun,
} from "../lib/session-store.ts";
import { ToolCallLine, type ToolChatItem } from "./tool-call-line.tsx";

interface DiffContent {
	path: string;
	removed: string[];
	added: string[];
}

// `Edit` shows old/new, `Write` shows the content as all-added; undefined
// (input still streaming, or an unexpected shape) falls back to the one-liner.
function diffContent(item: ToolChatItem): DiffContent | undefined {
	if (typeof item.input !== "object" || item.input === null) return undefined;
	const input = item.input as Record<string, unknown>;
	const path = input.file_path;
	if (typeof path !== "string") return undefined;
	if (item.name === "Write") {
		const content = input.content;
		if (typeof content !== "string") return undefined;
		return { path, removed: [], added: content.split("\n") };
	}
	const oldString = input.old_string;
	const newString = input.new_string;
	if (typeof oldString !== "string" || typeof newString !== "string") {
		return undefined;
	}
	return { path, removed: oldString.split("\n"), added: newString.split("\n") };
}

function MiniDiff(props: { diff: DiffContent }) {
	return (
		<div class="rounded-md border text-xs">
			<div class="border-b px-2 py-1 font-mono text-muted-foreground">
				{props.diff.path}
			</div>
			<pre class="max-h-48 overflow-y-auto whitespace-pre-wrap p-1 font-mono">
				<For each={props.diff.removed}>
					{(line) => (
						<div class="bg-destructive/10 text-destructive">- {line}</div>
					)}
				</For>
				<For each={props.diff.added}>
					{(line) => <div class="bg-success/10 text-success">+ {line}</div>}
				</For>
			</pre>
		</div>
	);
}

function ToolActivity(props: { item: ToolChatItem }) {
	const diff = () =>
		props.item.name === "Edit" || props.item.name === "Write"
			? diffContent(props.item)
			: undefined;
	return (
		<Show when={diff()} fallback={<ToolCallLine item={props.item} />}>
			{(content) => <MiniDiff diff={content()} />}
		</Show>
	);
}

function asType<T extends ChatItem["type"]>(
	item: ChatItem,
	type: T,
): Extract<ChatItem, { type: T }> | false {
	return item.type === type ? (item as Extract<ChatItem, { type: T }>) : false;
}

function TimelineItem(props: { item: ChatItem }) {
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
				{(item) => <ToolActivity item={item()} />}
			</Match>
			<Match when={asType(props.item, "compact")}>
				{(item) => (
					<p class="text-xs text-muted-foreground">
						Context compacted ({item().trigger}) ·{" "}
						{formatTokens(item().preTokens)} → {formatTokens(item().postTokens)}
					</p>
				)}
			</Match>
		</Switch>
	);
}

type RunAction = "steer" | "resume" | "pause" | "stop";

export function ActivityPane(props: { story: Story }) {
	// One session id per steered or answered run: every segment resumes the
	// same id, so the whole run lands in one timeline. A finished run's stream
	// stays viewable through the latest closed entry.
	const openEntry = () =>
		props.story.frontmatter.runs.findLast((run) => run.outcome === undefined);
	const entry = (): Run | undefined =>
		openEntry() ?? props.story.frontmatter.runs.at(-1);
	const status = () => props.story.frontmatter.status;
	const paused = () => openEntry()?.paused === true;
	const briefEdited = () => {
		const open = openEntry();
		return open !== undefined && briefHash(props.story.body) !== open.brief;
	};

	const [draft, setDraft] = createSignal("");
	const [pending, setPending] = createSignal<RunAction>();
	let timelineRef: HTMLDivElement | undefined;

	async function act(action: RunAction, message?: string): Promise<void> {
		setPending(action);
		try {
			if (action === "pause") await pauseRun(props.story.id);
			else if (action === "stop") await stopRun(props.story.id);
			else {
				await steerRun(props.story.id, message);
				setDraft("");
			}
		} catch {
			// The store already toasted; a failed steer keeps its draft.
		} finally {
			setPending(undefined);
		}
	}

	function steer(): void {
		const message = draft().trim();
		if (message === "" || pending() !== undefined) return;
		void act("steer", message);
	}

	return (
		<Show
			when={entry()}
			fallback={<EmptyState title="Activity" description="No runs yet" />}
		>
			{(run) => {
				const chat = () => chatFor(run().session);
				createEffect(() => {
					// Track everything that grows the timeline, including the
					// streaming tail's text, then pin to the bottom.
					const items = chat().items;
					const last = items[items.length - 1];
					if (last?.type === "assistant") void last.text;
					if (last?.type === "tool") void last.done;
					chat().busy;
					if (timelineRef !== undefined) {
						timelineRef.scrollTop = timelineRef.scrollHeight;
					}
				});
				return (
					<div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
						<Show when={briefEdited()}>
							<p class="shrink-0 rounded-md border border-warning bg-warning/10 px-3 py-2 text-xs">
								The brief was edited since this run started; the change takes
								effect on the next attempt.
							</p>
						</Show>
						<div
							ref={timelineRef}
							class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
						>
							<For each={chat().items}>
								{(item) => <TimelineItem item={item} />}
							</For>
							<Show when={chat().busy}>
								<Loader text="run in progress" class="text-xs" />
							</Show>
							<Show when={paused()}>
								<p class="text-xs text-muted-foreground">Run paused</p>
							</Show>
						</div>
						<Show when={openEntry() !== undefined}>
							<div class="flex shrink-0 items-center gap-2">
								<Switch>
									<Match when={status() === "running" && !paused()}>
										<Button
											size="sm"
											variant="outline"
											disabled={pending() !== undefined}
											onClick={() => void act("pause")}
										>
											Pause
										</Button>
									</Match>
									<Match when={status() === "running" && paused()}>
										<Button
											size="sm"
											variant="outline"
											disabled={pending() !== undefined}
											onClick={() => void act("resume")}
										>
											Resume
										</Button>
									</Match>
								</Switch>
								<Show
									when={status() === "running" || status() === "needs-input"}
								>
									<Button
										size="sm"
										variant="destructive"
										disabled={pending() !== undefined}
										onClick={() => void act("stop")}
									>
										Stop
									</Button>
								</Show>
							</div>
						</Show>
						<Show when={status() === "running"}>
							<form
								class="flex shrink-0 items-end gap-2"
								onSubmit={(event) => {
									event.preventDefault();
									steer();
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
											steer();
										}
									}}
									placeholder="Steer the run…"
									aria-label="Steering message"
								/>
								<Button
									type="submit"
									size="sm"
									disabled={pending() !== undefined}
								>
									Steer
								</Button>
							</form>
						</Show>
					</div>
				);
			}}
		</Show>
	);
}
