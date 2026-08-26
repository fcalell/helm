import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { ScrollArea } from "@fcalell/plugin-solid-ui/components/scroll-area";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { createSignal, For, Match, Show, Switch } from "solid-js";
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
import { Banner } from "../ui/banner.tsx";
import { Bubble } from "../ui/bubble.tsx";
import { DiffLines } from "../ui/diff-grid.tsx";
import { Disclosure } from "../ui/disclosure.tsx";
import { Prose } from "../ui/prose.tsx";
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
		<Disclosure open summary={props.diff.path}>
			<DiffLines removed={props.diff.removed} added={props.diff.added} />
		</Disclosure>
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
				{(item) => <Bubble>{item().text}</Bubble>}
			</Match>
			<Match when={asType(props.item, "assistant")}>
				{(item) => (
					<Show when={item().text !== ""}>
						<Prose variant="caption">{item().text}</Prose>
					</Show>
				)}
			</Match>
			<Match when={asType(props.item, "tool")}>
				{(item) => <ToolActivity item={item()} />}
			</Match>
			<Match when={asType(props.item, "compact")}>
				{(item) => (
					<Text variant="micro" tone="ink-3">
						Context compacted ({item().trigger}) ·{" "}
						{formatTokens(item().preTokens)} → {formatTokens(item().postTokens)}
					</Text>
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
				return (
					<div class="flex min-h-0 flex-1 flex-col gap-stack overflow-hidden">
						<Show when={briefEdited()}>
							<Banner>
								<Text variant="micro" tone="warn">
									The brief was edited since this run started; the change takes
									effect on the next attempt.
								</Text>
							</Banner>
						</Show>
						<ScrollArea pinToBottom>
							<div class="flex flex-col gap-stack">
								<For each={chat().items}>
									{(item) => <TimelineItem item={item} />}
								</For>
								<Show when={chat().busy}>
									<Loader text="run in progress" />
								</Show>
								<Show when={paused()}>
									<Text variant="micro" tone="ink-3">
										Run paused
									</Text>
								</Show>
							</div>
						</ScrollArea>
						<Show when={openEntry() !== undefined}>
							<div class="flex shrink-0 items-center gap-row">
								<Switch>
									<Match when={status() === "running" && !paused()}>
										<Button
											size="sm"
											emphasis="secondary"
											disabled={pending() !== undefined}
											onClick={() => void act("pause")}
										>
											Pause
										</Button>
									</Match>
									<Match when={status() === "running" && paused()}>
										<Button
											size="sm"
											emphasis="secondary"
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
										emphasis="secondary"
										tone="danger"
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
								class="flex shrink-0 items-end gap-row"
								onSubmit={(event) => {
									event.preventDefault();
									steer();
								}}
							>
								<Textarea
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
