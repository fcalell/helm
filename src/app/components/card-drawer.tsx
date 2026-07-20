import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Checkbox } from "@fcalell/plugin-solid-ui/components/checkbox";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { Sheet } from "@fcalell/plugin-solid-ui/components/sheet";
import { Tabs } from "@fcalell/plugin-solid-ui/components/tabs";
import { For, Match, Show, Switch } from "solid-js";
import {
	BRIEF_SECTIONS,
	type ChecklistItem,
	PRESETS,
	type Status,
	type Story,
} from "../../board/schema.ts";
import { boardStore, moveStory, STATUS_LABELS } from "../lib/board-store.ts";
import { weakCriterion } from "../lib/criteria.ts";
import { refineSpawnFor, setStoryPreset } from "../lib/session-store.ts";
import { ActivityPane } from "./activity-pane.tsx";
import { ChatPane } from "./chat-pane.tsx";
import { GatePanel } from "./gate-panel.tsx";
import { RunQuestionPanel } from "./run-question-panel.tsx";

interface CardDrawerProps {
	story: Story | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tab?: string;
	onTabChange: (tab: string) => void;
}

function defaultTab(status: Status): string {
	if (status === "refining") return "chat";
	if (status === "running") return "activity";
	if (status === "review") return "diff";
	return "brief";
}

function ChecklistSection(props: {
	items: ChecklistItem[];
	// Weak-phrasing warnings apply to the criteria checklist alone.
	warn: boolean;
}) {
	return (
		<Show
			when={props.items.length > 0}
			fallback={<p class="mt-1 text-muted-foreground">None yet</p>}
		>
			<ul class="mt-2 flex flex-col gap-2">
				<For each={props.items}>
					{(item) => {
						const weak = () =>
							props.warn ? weakCriterion(item.text) : undefined;
						return (
							<li class="flex items-start gap-2">
								<Checkbox checked={item.checked} disabled label={item.text} />
								<Show when={weak()}>
									{(phrase) => (
										<span
											class="cursor-help text-warning"
											title={`Not measurable: "${phrase()}" — name the observable behavior instead`}
										>
											⚠
										</span>
									)}
								</Show>
							</li>
						);
					}}
				</For>
			</ul>
		</Show>
	);
}

export function BriefView(props: { story: Story }) {
	return (
		<div class="flex flex-col gap-4 text-sm">
			<For each={BRIEF_SECTIONS}>
				{(section) => (
					<div>
						<h3 class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
							{section}
						</h3>
						<Switch
							fallback={
								<p class="mt-1 whitespace-pre-wrap text-foreground">
									{props.story.brief.sections[section]?.trim() || "Not set"}
								</p>
							}
						>
							<Match when={section === "Acceptance criteria"}>
								<ChecklistSection items={props.story.brief.criteria} warn />
							</Match>
							<Match when={section === "Open questions"}>
								<ChecklistSection
									items={props.story.brief.openQuestions}
									warn={false}
								/>
							</Match>
						</Switch>
					</div>
				)}
			</For>
		</div>
	);
}

function ChatTab(props: { story: Story }) {
	const epic = () => boardStore.epics[props.story.epicId];
	// The pane binds to whatever session the frontmatter names, never to a
	// kind: the story's refine session first (or the one just spawned, until
	// the snapshot names it), else the epic's define session.
	const sessionId = () =>
		props.story.frontmatter.sessions.refine ??
		refineSpawnFor(props.story.id)?.sessionId ??
		epic()?.frontmatter.sessions.define;
	return (
		<div class="flex h-full min-h-0 flex-col gap-3">
			<GatePanel storyId={props.story.id} />
			<div class="min-h-0 flex-1">
				<Show
					when={sessionId()}
					fallback={
						<Show
							when={refineSpawnFor(props.story.id)}
							fallback={
								<EmptyState
									title="Chat"
									description="Press r on a Backlog card to start refining"
								/>
							}
						>
							<Loader text="starting the refine chat" class="text-xs" />
						</Show>
					}
				>
					{(id) => (
						<ChatPane
							sessionId={id()}
							artifactTitle="Brief"
							artifact={<BriefView story={props.story} />}
						/>
					)}
				</Show>
			</div>
		</div>
	);
}

const PRESET_LABELS = {
	guarded: "Guarded",
	auto: "Auto",
	manual: "Manual",
} as const;

// Three-way segmented selector; an absent frontmatter field reads Guarded,
// the default. Legal at any status: the preset binds at the next spawn.
function PresetSelector(props: { story: Story }) {
	const active = () => props.story.frontmatter.preset ?? "guarded";
	return (
		<fieldset class="flex items-center gap-1" aria-label="Permission preset">
			<For each={PRESETS}>
				{(preset) => (
					<Button
						size="sm"
						variant={active() === preset ? "secondary" : "ghost"}
						onClick={() => void setStoryPreset(props.story.id, preset)}
					>
						{PRESET_LABELS[preset]}
					</Button>
				)}
			</For>
		</fieldset>
	);
}

// The open run entry's pending question (frontmatter is the truth the panel
// renders from).
function openRunQuestion(story: Story) {
	return story.frontmatter.runs.findLast((run) => run.outcome === undefined)
		?.question;
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
								<Show when={story.frontmatter.status === "refining"}>
									<Button
										size="sm"
										variant="outline"
										onClick={() => moveStory(story.id, "ready")}
									>
										Move to Ready
									</Button>
								</Show>
								<PresetSelector story={story} />
							</div>
						</Sheet.Header>
						<Show
							when={
								story.frontmatter.status === "needs-input"
									? openRunQuestion(story)
									: undefined
							}
						>
							{(question) => (
								<div class="mt-4 shrink-0">
									<RunQuestionPanel storyId={story.id} question={question()} />
								</div>
							)}
						</Show>
						<Tabs
							value={props.tab ?? defaultTab(story.frontmatter.status)}
							onValueChange={props.onTabChange}
							class="mt-4 flex min-h-0 flex-1 flex-col"
							listClass="shrink-0"
							contentClass="mt-4 min-h-0 flex-1 overflow-y-auto"
							tabs={[
								{
									value: "brief",
									label: "Brief",
									content: <BriefView story={story} />,
								},
								{
									value: "chat",
									label: "Chat",
									content: <ChatTab story={story} />,
								},
								{
									value: "activity",
									label: "Activity",
									content: <ActivityPane story={story} />,
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
