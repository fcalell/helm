import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { Pair } from "@fcalell/plugin-solid-ui/components/pair";
import { Row } from "@fcalell/plugin-solid-ui/components/row";
import { ScrollArea } from "@fcalell/plugin-solid-ui/components/scroll-area";
import { Section } from "@fcalell/plugin-solid-ui/components/section";
import { Select } from "@fcalell/plugin-solid-ui/components/select";
import { Stack } from "@fcalell/plugin-solid-ui/components/stack";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { type JSX, Show } from "solid-js";
import {
	PRESETS,
	type Preset,
	presetSchema,
	type Status,
	type Story,
} from "../../board/schema.ts";
import { boardStore, STATUS_LABELS } from "../lib/board-store.ts";
import { refineSpawnFor, setStoryPreset } from "../lib/session-store.ts";
import { ChatDrawer, ChatDrawerTitle } from "../ui/chat-drawer.tsx";
import { DrawerTabs } from "../ui/drawer-tabs.tsx";
import { ActivityPane } from "./activity-pane.tsx";
import { BriefView } from "./brief-view.tsx";
import { ChatPane } from "./chat-pane.tsx";
import { DiffPane } from "./diff-pane.tsx";
import { GatePanel } from "./gate-panel.tsx";
import { StageBlock } from "./stage-block.tsx";

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
		<Section>
			<GatePanel story={props.story} />
			<Show
				when={sessionId()}
				fallback={
					<Show
						when={refineSpawnFor(props.story.id)}
						fallback={
							<EmptyState
								title="No chat yet"
								description="Start refining above to open one"
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
		</Section>
	);
}

const PRESET_LABELS: Record<Preset, string> = {
	guarded: "Guarded",
	auto: "Auto",
	manual: "Manual",
};

const PRESET_OPTIONS = PRESETS.map((preset) => ({
	value: preset,
	label: PRESET_LABELS[preset],
}));

function Property(props: { label: string; children: JSX.Element }) {
	return (
		<Pair row>
			<Text as="span" variant="micro" tone="ink-3">
				{props.label}
			</Text>
			{props.children}
		</Pair>
	);
}

// The story's settings row. The preset is legal at any status: it binds at
// the next spawn, and an absent frontmatter field reads Guarded.
function Properties(props: { story: Story }) {
	const epic = () => boardStore.epics[props.story.epicId];
	const depends = () => props.story.frontmatter.depends;
	return (
		<Row>
			<Property label="Epic">
				<Badge>{epic()?.slug ?? props.story.epicId}</Badge>
			</Property>
			<Property label="Preset">
				<Select
					options={PRESET_OPTIONS}
					value={props.story.frontmatter.preset ?? "guarded"}
					onValueChange={(value) =>
						void setStoryPreset(props.story.id, presetSchema.parse(value))
					}
				/>
			</Property>
			<Show when={depends().length > 0}>
				<Property label="Depends on">
					<Text as="span" variant="caption" mono>
						{depends().join(", ")}
					</Text>
				</Property>
			</Show>
		</Row>
	);
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
					<Stack>
						<Properties story={story} />
						<StageBlock
							story={story}
							onOpenChat={() => props.onTabChange("chat")}
						/>
					</Stack>
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
