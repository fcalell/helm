import { For, Show } from "solid-js";
import type { Epic, Story } from "../../board/schema.ts";
import { STATUSES } from "../../board/schema.ts";
import {
	orphanEpicIds,
	sortedEpics,
	storiesByStatus,
} from "../lib/board-store.ts";
import { BoardColumn } from "./board-column.tsx";
import { EpicLane } from "./epic-lane.tsx";

interface BoardGridProps {
	epics: Record<string, Epic>;
	stories: Record<string, Story>;
	epicView: boolean;
	selectedStoryId: string | null;
	onSelect: (id: string) => void;
	onOpen: (id: string) => void;
}

export function BoardGrid(props: BoardGridProps) {
	return (
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
									selectedStoryId={props.selectedStoryId}
									onSelect={props.onSelect}
									onOpen={props.onOpen}
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
								selectedStoryId={props.selectedStoryId}
								onSelect={props.onSelect}
								onOpen={props.onOpen}
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
								selectedStoryId={props.selectedStoryId}
								onSelect={props.onSelect}
								onOpen={props.onOpen}
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}
