import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Checkbox } from "@fcalell/plugin-solid-ui/components/checkbox";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Sheet } from "@fcalell/plugin-solid-ui/components/sheet";
import { Tabs } from "@fcalell/plugin-solid-ui/components/tabs";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createSignal, For, Show } from "solid-js";
import type { Status, Story } from "../../board/schema.ts";
import { boardStore, STATUS_LABELS } from "../lib/board-store.ts";
import { spawnDefineSession } from "../lib/session-store.ts";
import { ChatPane } from "./chat-pane.tsx";

interface CardDrawerProps {
	story: Story | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const PROSE_SECTIONS = ["Goal", "Approach", "Out of scope"] as const;

function defaultTab(status: Status): string {
	if (status === "refining") return "chat";
	if (status === "running") return "activity";
	if (status === "review") return "diff";
	return "brief";
}

function BriefTab(props: { story: Story }) {
	return (
		<div class="flex flex-col gap-4 text-sm">
			<For each={PROSE_SECTIONS}>
				{(section) => (
					<div>
						<h3 class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
							{section}
						</h3>
						<p class="mt-1 text-foreground">
							{props.story.brief.sections[section]?.trim() || "Not set"}
						</p>
					</div>
				)}
			</For>
			<div>
				<h3 class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
					Acceptance criteria
				</h3>
				<Show
					when={props.story.brief.criteria.length > 0}
					fallback={<p class="mt-1 text-muted-foreground">None yet</p>}
				>
					<ul class="mt-2 flex flex-col gap-2">
						<For each={props.story.brief.criteria}>
							{(item) => (
								<li>
									<Checkbox checked={item.checked} disabled label={item.text} />
								</li>
							)}
						</For>
					</ul>
				</Show>
			</div>
			<div>
				<h3 class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
					Open questions
				</h3>
				<Show
					when={props.story.brief.openQuestions.length > 0}
					fallback={<p class="mt-1 text-muted-foreground">None yet</p>}
				>
					<ul class="mt-2 flex flex-col gap-2">
						<For each={props.story.brief.openQuestions}>
							{(item) => (
								<li>
									<Checkbox checked={item.checked} disabled label={item.text} />
								</li>
							)}
						</For>
					</ul>
				</Show>
			</div>
		</div>
	);
}

// TODO: remove once define/refine entry points land
function DevChatEntry(props: { epicId: string }) {
	const [prompt, setPrompt] = createSignal("");
	const [spawning, setSpawning] = createSignal(false);
	return (
		<form
			class="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				const text = prompt().trim();
				if (text === "") return;
				setSpawning(true);
				spawnDefineSession(props.epicId, text)
					.catch((error: unknown) => {
						toast.error(
							error instanceof Error
								? error.message
								: "failed to spawn session",
						);
					})
					.finally(() => setSpawning(false));
			}}
		>
			<p class="text-sm text-muted-foreground">
				No chat session on this card yet. Start a define chat on epic{" "}
				{props.epicId} (dev only).
			</p>
			<Textarea
				size="sm"
				value={prompt()}
				onInput={(event) => setPrompt(event.currentTarget.value)}
				placeholder="First message to the define chat…"
				aria-label="First message"
			/>
			<Button
				type="submit"
				size="sm"
				class="self-start"
				disabled={spawning() || prompt().trim() === ""}
			>
				{spawning() ? "Spawning…" : "Start define chat (dev)"}
			</Button>
		</form>
	);
}

function ChatTab(props: { story: Story }) {
	const epic = () => boardStore.epics[props.story.epicId];
	// The pane binds to whatever session the frontmatter names, never to a
	// kind: the story's refine session first, else the epic's define session.
	const sessionId = () =>
		props.story.frontmatter.sessions.refine ??
		epic()?.frontmatter.sessions.define;
	return (
		<Show
			when={sessionId()}
			fallback={
				import.meta.env.DEV ? (
					<DevChatEntry epicId={props.story.epicId} />
				) : (
					<EmptyState
						title="Chat"
						description="Arrives with define and refine chats"
					/>
				)
			}
		>
			{(id) => <ChatPane sessionId={id()} />}
		</Show>
	);
}

export function CardDrawer(props: CardDrawerProps) {
	return (
		<Sheet open={props.open} onOpenChange={props.onOpenChange}>
			<Show when={props.story} keyed>
				{(story) => (
					<Sheet.Content
						position="right"
						size="xl"
						// The tab contents own their scrolling (contentClass below), so
						// the sheet body clips instead of adding a second scrollbar.
						class="flex flex-col overflow-hidden"
					>
						<Sheet.Header class="shrink-0">
							<div class="flex items-center gap-2">
								<Sheet.Title>
									{story.id} · {story.brief.title || story.id}
								</Sheet.Title>
								<Badge>{STATUS_LABELS[story.frontmatter.status]}</Badge>
							</div>
						</Sheet.Header>
						{/* Uncontrolled on purpose: the keyed Show remounts this
						    subtree per story, so defaultValue re-evaluates exactly
						    when the status-driven default should apply. Controlled
						    value freezes the renderer (solid-ui Tabs bug). */}
						<Tabs
							defaultValue={defaultTab(story.frontmatter.status)}
							class="mt-4 flex min-h-0 flex-1 flex-col"
							// Without `relative` the active-tab indicator anchors to the
							// sheet (its nearest positioned ancestor) and paints at the
							// drawer's bottom edge.
							listClass="relative shrink-0"
							contentClass="mt-4 min-h-0 flex-1 overflow-y-auto"
							tabs={[
								{
									value: "brief",
									label: "Brief",
									content: <BriefTab story={story} />,
								},
								{
									value: "chat",
									label: "Chat",
									content: <ChatTab story={story} />,
								},
								{
									value: "activity",
									label: "Activity",
									content: (
										<EmptyState
											title="Activity"
											description="Arrives with runs"
										/>
									),
								},
								{
									value: "diff",
									label: "Diff",
									content: (
										<EmptyState
											title="Diff"
											description="Arrives with review"
										/>
									),
								},
								{
									value: "history",
									label: "History",
									content: (
										<EmptyState
											title="History"
											description="Arrives with runs"
										/>
									),
								},
							]}
						/>
					</Sheet.Content>
				)}
			</Show>
		</Sheet>
	);
}
