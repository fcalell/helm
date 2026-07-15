import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { For, Show } from "solid-js";
import type { Epic, Status, Story } from "../../board/schema.ts";
import { STATUS_LABELS } from "../lib/board-store.ts";
import { StoryCard } from "./story-card.tsx";

interface BoardColumnProps {
	status: Status;
	stories: Story[];
	epics: Record<string, Epic>;
	selectedStoryId: string | null;
	onSelect: (id: string) => void;
	onOpen: (id: string) => void;
	heightClass?: string;
}

export function BoardColumn(props: BoardColumnProps) {
	return (
		<div
			class={`flex w-72 shrink-0 flex-col rounded-lg border border-border bg-card/40 ${props.heightClass ?? "h-full"}`}
		>
			<div class="flex items-center justify-between border-b border-border px-3 py-2">
				<span class="text-sm font-semibold text-foreground">
					{STATUS_LABELS[props.status]}
				</span>
				<Badge variant="secondary">{props.stories.length}</Badge>
			</div>
			<div class="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
				<Show
					when={props.stories.length > 0}
					fallback={
						<p class="py-6 text-center text-xs text-muted-foreground">
							No stories
						</p>
					}
				>
					<For each={props.stories}>
						{(story) => (
							<StoryCard
								story={story}
								epics={props.epics}
								selected={props.selectedStoryId === story.id}
								onSelect={() => props.onSelect(story.id)}
								onOpen={() => props.onOpen(story.id)}
							/>
						)}
					</For>
				</Show>
			</div>
		</div>
	);
}
