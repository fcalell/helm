import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { ScrollArea } from "@fcalell/plugin-solid-ui/components/scroll-area";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { For, Show } from "solid-js";
import type { Epic, Story } from "../../board/schema.ts";
import { STATUSES } from "../../board/schema.ts";
import { epicProgress, storiesByStatus } from "../lib/board-store.ts";
import { BoardColumn } from "./board-column.tsx";

interface EpicLaneProps {
	epicId: string;
	title: string;
	epics: Record<string, Epic>;
	stories: Record<string, Story>;
	onOpen: (id: string) => void;
	onRefine: (id: string) => void;
	// Absent on orphan lanes (no epic file, so no chat to open).
	onOpenChat?: (epicId: string) => void;
}

export function EpicLane(props: EpicLaneProps) {
	const progress = () => epicProgress(props.epicId, props.stories);

	return (
		<section class="flex flex-col gap-row">
			<div class="flex items-center gap-row">
				<Text as="h2" variant="rowtitle">
					{props.title}
				</Text>
				<Badge>{`${progress().done}/${progress().total}`}</Badge>
				<Show when={props.onOpenChat}>
					{(open) => (
						<Button
							size="sm"
							emphasis="tertiary"
							onClick={() => open()(props.epicId)}
						>
							Chat
						</Button>
					)}
				</Show>
			</div>
			<ScrollArea axis="x">
				<div class="flex gap-gutter">
					<For each={STATUSES}>
						{(status) => (
							<BoardColumn
								status={status}
								stories={storiesByStatus(props.stories, status).filter(
									(story) => story.epicId === props.epicId,
								)}
								epics={props.epics}
								onOpen={props.onOpen}
								onRefine={props.onRefine}
								height="lane"
								laneId={props.epicId}
							/>
						)}
					</For>
				</div>
			</ScrollArea>
		</section>
	);
}
