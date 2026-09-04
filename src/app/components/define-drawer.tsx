import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Row } from "@fcalell/plugin-solid-ui/components/row";
import { Stack } from "@fcalell/plugin-solid-ui/components/stack";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { For, Show } from "solid-js";
import {
	boardStore,
	STATUS_LABELS,
	sortedStories,
} from "../lib/board-store.ts";
import { ChatDrawer, ChatDrawerTitle } from "../ui/chat-drawer.tsx";
import { ChatPane } from "./chat-pane.tsx";

export interface DefineTarget {
	epicId: string;
	sessionId?: string;
}

export interface DefineDrawerProps {
	target: DefineTarget;
	onClose: () => void;
}

export function DefineDrawer(props: DefineDrawerProps) {
	const epic = () => boardStore.epics[props.target.epicId];
	const sessionId = () =>
		props.target.sessionId ?? epic()?.frontmatter.sessions.define;
	const stories = () =>
		sortedStories(
			Object.values(boardStore.stories).filter(
				(story) => story.epicId === props.target.epicId,
			),
		);

	return (
		<ChatDrawer
			onClose={props.onClose}
			title={
				<>
					<ChatDrawerTitle>
						{props.target.epicId} · {epic()?.title ?? "New epic"}
					</ChatDrawerTitle>
					<Badge>Define</Badge>
				</>
			}
		>
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
								<Stack>
									<For each={stories()}>
										{(story) => (
											<Row>
												<Text as="span" variant="micro" tone="ink-3" mono>
													{story.id}
												</Text>
												<Text as="span" variant="caption">
													{story.brief.title || story.id}
												</Text>
												<Badge>{STATUS_LABELS[story.frontmatter.status]}</Badge>
											</Row>
										)}
									</For>
								</Stack>
							</Show>
						}
					/>
				)}
			</Show>
		</ChatDrawer>
	);
}
