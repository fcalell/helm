import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Sheet } from "@fcalell/plugin-solid-ui/components/sheet";
import { For, Show } from "solid-js";
import {
	boardStore,
	STATUS_LABELS,
	sortedStories,
} from "../lib/board-store.ts";
import { ChatPane } from "./chat-pane.tsx";

export interface DefineTarget {
	epicId: string;
	sessionId?: string;
}

export interface DefineDrawerProps {
	target: DefineTarget | null;
	onOpenChange: (open: boolean) => void;
}

// The epic breakdown chat: the artifact pane lists the epic's cards so
// accepted stories are visible as they land in Backlog.
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

	return (
		<Sheet open={props.target !== null} onOpenChange={props.onOpenChange}>
			<Sheet.Content
				position="right"
				size="xl"
				class="flex flex-col overflow-hidden"
			>
				<Sheet.Header class="shrink-0">
					<div class="flex items-center gap-2">
						<Sheet.Title>
							{props.target?.epicId} · {epic()?.title ?? "New epic"}
						</Sheet.Title>
						<Badge>Define</Badge>
					</div>
				</Sheet.Header>
				<div class="mt-4 min-h-0 flex-1">
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
										fallback={<p>No stories yet; accepted ones land here.</p>}
									>
										<ul class="flex flex-col gap-1">
											<For each={stories()}>
												{(story) => (
													<li class="flex items-center gap-2 text-sm">
														<span class="font-mono text-xs text-muted-foreground">
															{story.id}
														</span>
														<span>{story.brief.title || story.id}</span>
														<Badge variant="outline">
															{STATUS_LABELS[story.frontmatter.status]}
														</Badge>
													</li>
												)}
											</For>
										</ul>
									</Show>
								}
							/>
						)}
					</Show>
				</div>
			</Sheet.Content>
		</Sheet>
	);
}
