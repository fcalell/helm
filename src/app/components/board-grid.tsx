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
import { BoardStack, BoardStrip } from "../ui/board-surface.tsx";
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
		// Only the same-status drop is a no-op here; a story missing from the
		// store falls through so `moveStory` can report it.
		if (props.stories[storyId]?.frontmatter.status === targetStatus) return;
		moveStory(storyId, targetStatus);
	}

	return (
		<DragDropProvider onDragEnd={handleDragEnd}>
			<DragDropSensors>
				<Show
					when={props.epicView}
					fallback={
						<BoardStrip>
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
						</BoardStrip>
					}
				>
					<BoardStack>
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
					</BoardStack>
				</Show>
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
