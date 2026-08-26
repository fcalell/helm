import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createDroppable } from "@thisbeyond/solid-dnd";
import { For, Show } from "solid-js";
import type { Epic, Status, Story } from "../../board/schema.ts";
import { STATUS_LABELS } from "../lib/board-store.ts";
import { dropId } from "../lib/dnd.ts";
import { ColumnFrame } from "../ui/column-frame.tsx";
import { StoryCard } from "./story-card.tsx";

interface BoardColumnProps {
	status: Status;
	stories: Story[];
	epics: Record<string, Epic>;
	onOpen: (id: string) => void;
	onRefine: (id: string) => void;
	// Lane columns are capped so several lanes stack on one page.
	height?: "full" | "lane";
	laneId?: string;
}

export function BoardColumn(props: BoardColumnProps) {
	const droppable = createDroppable(dropId(props.status, props.laneId));

	return (
		<ColumnFrame
			ref={droppable.ref}
			title={STATUS_LABELS[props.status]}
			height={props.height ?? "full"}
			count={<Badge>{props.stories.length}</Badge>}
		>
			<Show
				when={props.stories.length > 0}
				fallback={
					<Text variant="micro" tone="ink-3">
						No stories
					</Text>
				}
			>
				<For each={props.stories}>
					{(story) => (
						<StoryCard
							story={story}
							epics={props.epics}
							onOpen={() => props.onOpen(story.id)}
							onRefine={() => props.onRefine(story.id)}
						/>
					)}
				</For>
			</Show>
		</ColumnFrame>
	);
}
