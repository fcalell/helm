import {
	DragDropProvider,
	DragDropSensors,
	type DragEvent,
	DragOverlay,
} from "@thisbeyond/solid-dnd";
import { For, Show } from "solid-js";
import type { Epic, Story } from "../../board/schema.ts";
import { STATUSES } from "../../board/schema.ts";
import {
	moveStory,
	orphanEpicIds,
	sortedEpics,
	storiesByStatus,
} from "../lib/board-store.ts";
import { statusFromDropId } from "../lib/dnd.ts";
import { BoardColumn } from "./board-column.tsx";
import { EpicLane } from "./epic-lane.tsx";
import { StoryCardOverlay } from "./story-card.tsx";

interface BoardGridProps {
	epics: Record<string, Epic>;
	stories: Record<string, Story>;
	epicView: boolean;
	onOpen: (id: string) => void;
	onRefine: (id: string) => void;
	onOpenEpicChat: (epicId: string) => void;
}

export function BoardGrid(props: BoardGridProps) {
	function handleDragEnd(event: DragEvent): void {
		if (!event.droppable) return;
		const targetStatus = statusFromDropId(event.droppable.id);
		if (!targetStatus) return;
		const storyId = String(event.draggable.id);
		const story = props.stories[storyId];
		if (!story || story.frontmatter.status === targetStatus) return;
		moveStory(storyId, targetStatus);
	}

	return (
		<DragDropProvider onDragEnd={handleDragEnd}>
			<DragDropSensors>
				<div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
					<Show
						when={props.epicView}
						fallback={
							<div class="flex h-full gap-4 overflow-x-auto p-4">
								<For each={STATUSES}>
									{(status) => (
										<BoardColumn
											status={status}
											stories={storiesByStatus(props.stories, status)}
											epics={props.epics}
											onOpen={props.onOpen}
											onRefine={props.onRefine}
										/>
									)}
								</For>
							</div>
						}
					>
						<div class="flex flex-col gap-6 p-4">
							<For each={sortedEpics(props.epics)}>
								{(epic) => (
									<EpicLane
										epicId={epic.id}
										title={epic.title}
										epics={props.epics}
										stories={props.stories}
										onOpen={props.onOpen}
										onRefine={props.onRefine}
										onOpenChat={props.onOpenEpicChat}
									/>
								)}
							</For>
							<For each={orphanEpicIds(props.epics, props.stories)}>
								{(epicId) => (
									<EpicLane
										epicId={epicId}
										title={epicId}
										epics={props.epics}
										stories={props.stories}
										onOpen={props.onOpen}
										onRefine={props.onRefine}
									/>
								)}
							</For>
						</div>
					</Show>
				</div>
				<DragOverlay>
					{(draggable) => {
						const story = draggable
							? props.stories[String(draggable.id)]
							: undefined;
						return (
							<Show when={story}>
								{(overlayStory) => (
									<StoryCardOverlay
										story={overlayStory()}
										epics={props.epics}
									/>
								)}
							</Show>
						);
					}}
				</DragOverlay>
			</DragDropSensors>
		</DragDropProvider>
	);
}
