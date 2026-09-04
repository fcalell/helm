import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
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
	epicBands,
	moveStory,
	STATUS_LABELS,
	storiesByStatus,
} from "../lib/board-store.ts";
import { statusFromDropId } from "../lib/dnd.ts";
import { BoardTable } from "../ui/board-table.tsx";
import { EpicBand } from "./epic-band.tsx";
import { StoryCardOverlay } from "./story-card.tsx";

interface BoardGridProps {
	epics: Record<string, Epic>;
	stories: Record<string, Story>;
	onOpen: (id: string) => void;
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
				<BoardTable columns={STATUSES.length}>
					<For each={STATUSES}>
						{(status) => (
							<BoardTable.Header
								title={STATUS_LABELS[status]}
								count={
									<Badge>{storiesByStatus(props.stories, status).length}</Badge>
								}
							/>
						)}
					</For>
					<For each={epicBands(props.epics, props.stories)}>
						{(band) => (
							<EpicBand
								band={band}
								epics={props.epics}
								onOpen={props.onOpen}
								onOpenChat={band.hasEpic ? props.onOpenEpicChat : undefined}
							/>
						)}
					</For>
				</BoardTable>
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
