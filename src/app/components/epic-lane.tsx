import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { For } from "solid-js";
import type { Epic, Story } from "../../board/schema.ts";
import { STATUSES } from "../../board/schema.ts";
import { epicProgress, storiesByStatus } from "../lib/board-store.ts";
import { BoardColumn } from "./board-column.tsx";

interface EpicLaneProps {
	epicId: string;
	title: string;
	epics: Record<string, Epic>;
	stories: Record<string, Story>;
	selectedStoryId: string | null;
	onSelect: (id: string) => void;
	onOpen: (id: string) => void;
}

export function EpicLane(props: EpicLaneProps) {
	const progress = () => epicProgress(props.epicId, props.stories);

	return (
		<section class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<h2 class="text-sm font-semibold text-foreground">{props.title}</h2>
				<Badge variant="secondary">{`${progress().done}/${progress().total}`}</Badge>
			</div>
			<div class="flex gap-4 overflow-x-auto pb-2">
				<For each={STATUSES}>
					{(status) => (
						<BoardColumn
							status={status}
							stories={storiesByStatus(props.stories, status).filter(
								(story) => story.epicId === props.epicId,
							)}
							epics={props.epics}
							selectedStoryId={props.selectedStoryId}
							onSelect={props.onSelect}
							onOpen={props.onOpen}
							heightClass="h-80"
							laneId={props.epicId}
						/>
					)}
				</For>
			</div>
		</section>
	);
}
