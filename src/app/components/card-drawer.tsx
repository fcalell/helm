import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Checkbox } from "@fcalell/plugin-solid-ui/components/checkbox";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { ScrollArea } from "@fcalell/plugin-solid-ui/components/scroll-area";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
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
import { ChatDrawer, ChatDrawerTitle } from "../ui/chat-drawer.tsx";
import { DrawerTabs } from "../ui/drawer-tabs.tsx";
import { Eyebrow } from "../ui/eyebrow.tsx";
import { PlainText } from "../ui/plain-text.tsx";
import { ActivityPane } from "./activity-pane.tsx";
import { ChatPane } from "./chat-pane.tsx";
import { DiffPane } from "./diff-pane.tsx";
import { GatePanel } from "./gate-panel.tsx";
import { ReviewExits } from "./review-exits.tsx";
import { RunQuestionPanel } from "./run-question-panel.tsx";

interface CardDrawerProps {
	story: Story | undefined;
	onClose: () => void;
	tab?: string;
	onTabChange: (tab: string) => void;
}

function defaultTab(status: Status): string {
	if (status === "refining") return "chat";
	if (status === "running") return "activity";
	if (status === "review") return "diff";
	return "brief";
}

export function ChecklistSection(props: {
	items: ChecklistItem[];
	// Weak-phrasing warnings apply to the criteria checklist alone.
	warn: boolean;
}) {
	return (
		<Show
			when={props.items.length > 0}
			fallback={
				<Text variant="caption" tone="ink-3">
					None yet
				</Text>
			}
		>
			<ul class="flex flex-col gap-row">
				<For each={props.items}>
					{(item) => {
						const weak = () =>
							props.warn ? weakCriterion(item.text) : undefined;
						return (
							<li class="flex items-start gap-row">
								<Checkbox checked={item.checked} disabled label={item.text} />
								<Show when={weak()}>
									{(phrase) => (
										<Text
											as="span"
											variant="caption"
											tone="warn"
											title={`Not measurable: "${phrase()}" — name the observable behavior instead`}
										>
											⚠
										</Text>
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
		<div class="flex flex-col gap-section">
			<For each={BRIEF_SECTIONS}>
				{(section) => (
					<div class="flex flex-col gap-row">
						<Eyebrow>{section}</Eyebrow>
						<Switch
							fallback={
								<PlainText variant="caption">
									{props.story.brief.sections[section]?.trim() || "Not set"}
								</PlainText>
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
		<div class="flex min-h-0 flex-1 flex-col gap-stack">
			<GatePanel story={props.story} />
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
						<Loader text="starting the refine chat" />
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
		<fieldset class="flex items-center gap-pair" aria-label="Permission preset">
			<For each={PRESETS}>
				{(preset) => (
					<Button
						size="sm"
						emphasis={active() === preset ? "primary" : "tertiary"}
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
		<Show when={props.story} keyed>
			{(story) => (
				<ChatDrawer
					onClose={props.onClose}
					title={
						<>
							<ChatDrawerTitle>
								{story.id} · {story.brief.title || story.id}
							</ChatDrawerTitle>
							<Badge>{STATUS_LABELS[story.frontmatter.status]}</Badge>
						</>
					}
				>
					<div class="flex shrink-0 flex-wrap items-center gap-row">
						<Show when={story.frontmatter.status === "refining"}>
							<Button
								size="sm"
								emphasis="secondary"
								onClick={() => moveStory(story.id, "ready")}
							>
								Move to Ready
							</Button>
						</Show>
						<PresetSelector story={story} />
					</div>
					<Show when={story.frontmatter.status === "review"}>
						<div class="flex shrink-0">
							<ReviewExits story={story} />
						</div>
					</Show>
					<Show
						when={
							story.frontmatter.status === "needs-input"
								? openRunQuestion(story)
								: undefined
						}
					>
						{(question) => (
							<div class="flex shrink-0 flex-col">
								<RunQuestionPanel storyId={story.id} question={question()} />
							</div>
						)}
					</Show>
					<DrawerTabs
						value={props.tab ?? defaultTab(story.frontmatter.status)}
						onValueChange={props.onTabChange}
						tabs={[
							{
								value: "brief",
								label: "Brief",
								content: (
									<ScrollArea>
										<BriefView story={story} />
									</ScrollArea>
								),
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
									<Show
										when={story.frontmatter.status === "review"}
										fallback={
											<EmptyState
												title="Diff"
												description="Arrives with review"
											/>
										}
									>
										<ScrollArea>
											<DiffPane story={story} />
										</ScrollArea>
									</Show>
								),
							},
							{
								value: "history",
								label: "History",
								content: (
									<EmptyState title="History" description="Arrives with runs" />
								),
							},
						]}
					/>
				</ChatDrawer>
			)}
		</Show>
	);
}
