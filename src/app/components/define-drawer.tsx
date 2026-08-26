import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createSignal, For, Show } from "solid-js";
import {
	boardStore,
	STATUS_LABELS,
	sortedStories,
} from "../lib/board-store.ts";
import { Drawer, DrawerHeader, DrawerTitle } from "../ui/drawer.tsx";
import { ChatPane } from "./chat-pane.tsx";
import { ExpandToggle } from "./expand-toggle.tsx";

export interface DefineTarget {
	epicId: string;
	sessionId?: string;
}

export interface DefineDrawerProps {
	target: DefineTarget | null;
	onOpenChange: (open: boolean) => void;
}

export function DefineDrawer(props: DefineDrawerProps) {
	const epic = () =>
		props.target === null ? undefined : boardStore.epics[props.target.epicId];
	const sessionId = () =>
		props.target?.sessionId ?? epic()?.frontmatter.sessions.define;
	const stories = () =>
		sortedStories(
			Object.values(boardStore.stories).filter(
				(story) => story.epicId === props.target?.epicId,
			),
		);
	const [expanded, setExpanded] = createSignal(false);

	return (
		<Drawer
			open={props.target !== null}
			expanded={expanded()}
			onOpenChange={(open) => {
				if (!open) setExpanded(false);
				props.onOpenChange(open);
			}}
		>
			<DrawerHeader>
				<DrawerTitle>
					{props.target?.epicId} · {epic()?.title ?? "New epic"}
				</DrawerTitle>
				<Badge>Define</Badge>
				<ExpandToggle
					expanded={expanded()}
					onToggle={() => setExpanded((value) => !value)}
				/>
			</DrawerHeader>
			<Show
				when={sessionId()}
				fallback={
					<EmptyState
						title="Define chat"
						description="No define session is attached to this epic."
					/>
				}
			>
				{(id) => (
					<ChatPane
						sessionId={id()}
						artifactTitle="Stories"
						artifact={
							<Show
								when={stories().length > 0}
								fallback={
									<Text variant="caption" tone="ink-3">
										No stories yet; accepted ones land here.
									</Text>
								}
							>
								<ul class="flex flex-col gap-pair">
									<For each={stories()}>
										{(story) => (
											<li class="flex items-center gap-row">
												<Text as="span" variant="micro" tone="ink-3" mono>
													{story.id}
												</Text>
												<Text as="span" variant="caption">
													{story.brief.title || story.id}
												</Text>
												<Badge>{STATUS_LABELS[story.frontmatter.status]}</Badge>
											</li>
										)}
									</For>
								</ul>
							</Show>
						}
					/>
				)}
			</Show>
		</Drawer>
	);
}
