import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Card } from "@fcalell/plugin-solid-ui/components/card";
import { Tooltip } from "@fcalell/plugin-solid-ui/components/tooltip";
import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { Show } from "solid-js";
import type { Epic, Story } from "../../board/schema.ts";

interface StoryCardProps {
	story: Story;
	epics: Record<string, Epic>;
	selected: boolean;
	onSelect: () => void;
	onOpen: () => void;
}

export function StoryCard(props: StoryCardProps) {
	const epicLabel = () =>
		props.epics[props.story.epicId]?.slug ?? props.story.epicId;
	const criteria = () => props.story.brief.criteria;
	const checkedCount = () => criteria().filter((item) => item.checked).length;
	const openQuestions = () =>
		props.story.brief.openQuestions.filter((item) => !item.checked).length;
	const depends = () => props.story.frontmatter.depends;
	const isRunning = () => props.story.frontmatter.status === "running";
	const isRefining = () => props.story.frontmatter.status === "refining";

	return (
		<Card
			data-story-id={props.story.id}
			role="button"
			tabIndex={0}
			onClick={() => {
				props.onSelect();
				props.onOpen();
			}}
			class={cn(
				"cursor-pointer gap-2 p-3 transition-shadow duration-base ease-ui",
				props.selected && "ring-2 ring-ring",
				isRunning() && "helm-card-pulse",
			)}
		>
			<p class="text-sm font-semibold text-foreground">
				{props.story.brief.title || props.story.id}
			</p>
			<div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
				<Badge variant="outline">{epicLabel()}</Badge>
				<Show when={criteria().length > 0}>
					<span>
						{checkedCount() > 0
							? `${checkedCount()}/${criteria().length} criteria`
							: `${criteria().length} criteria`}
					</span>
				</Show>
				<Show when={depends().length > 0}>
					<Tooltip>
						<Tooltip.Trigger as="span">{`needs ${depends()[0]}`}</Tooltip.Trigger>
						<Tooltip.Content>{depends().join(", ")}</Tooltip.Content>
					</Tooltip>
				</Show>
				<Show when={isRefining() && openQuestions() > 0}>
					<span>{`${openQuestions()} open questions`}</span>
				</Show>
			</div>
		</Card>
	);
}
