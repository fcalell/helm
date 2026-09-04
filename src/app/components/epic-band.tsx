import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Item } from "@fcalell/plugin-solid-ui/components/item";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createDroppable } from "@thisbeyond/solid-dnd";
import { ChevronDown, ChevronRight } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import type { Epic, Status, Story } from "../../board/schema.ts";
import { STATUSES } from "../../board/schema.ts";
import type { EpicBand as Band } from "../lib/board-store.ts";
import { dropId } from "../lib/dnd.ts";
import { BoardTable } from "../ui/board-table.tsx";
import { IconButton } from "../ui/icon-button.tsx";
import { StoryCard } from "./story-card.tsx";

interface EpicBandProps {
	band: Band;
	epics: Record<string, Epic>;
	onOpen: (id: string) => void;
	// Absent on orphan bands (no epic file, so no chat to open).
	onOpenChat?: (epicId: string) => void;
}

// Done accumulates for the epic's whole life and nothing drags into it, so
// its cell lists one row per story rather than cards and the band's height
// stays with the live work.
function DoneList(props: { stories: Story[]; onOpen: (id: string) => void }) {
	return (
		<Item.Group>
			<For each={props.stories}>
				{(story) => (
					<Item size="xs">
						<button
							type="button"
							class="flex w-full items-center"
							onClick={() => props.onOpen(story.id)}
						>
							<Item.Content>
								<Item.Title>
									{story.id} · {story.brief.title || story.id}
								</Item.Title>
							</Item.Content>
						</button>
					</Item>
				)}
			</For>
		</Item.Group>
	);
}

function BandCell(props: {
	band: Band;
	status: Status;
	epics: Record<string, Epic>;
	onOpen: (id: string) => void;
}) {
	const droppable = createDroppable(dropId(props.status, props.band.epicId));
	const stories = () =>
		props.band.stories.filter(
			(story) => story.frontmatter.status === props.status,
		);
	return (
		<BoardTable.Cell ref={droppable.ref} active={droppable.isActiveDroppable}>
			<Show
				when={props.status === "done"}
				fallback={
					<For each={stories()}>
						{(story) => (
							<StoryCard
								story={story}
								epics={props.epics}
								onOpen={() => props.onOpen(story.id)}
							/>
						)}
					</For>
				}
			>
				<DoneList stories={stories()} onOpen={props.onOpen} />
			</Show>
		</BoardTable.Cell>
	);
}

// A completed epic starts collapsed: its band is a title line until opened.
export function EpicBand(props: EpicBandProps) {
	const [open, setOpen] = createSignal(!props.band.completed);
	const done = () =>
		props.band.stories.filter((story) => story.frontmatter.status === "done")
			.length;

	return (
		<>
			<BoardTable.Band>
				<IconButton
					label={open() ? "Collapse epic" : "Expand epic"}
					onClick={() => setOpen((value) => !value)}
				>
					<Show when={open()} fallback={<ChevronRight />}>
						<ChevronDown />
					</Show>
				</IconButton>
				<Text as="h2" variant="rowtitle">
					{props.band.title}
				</Text>
				<Badge tone={props.band.completed ? "ok" : "neutral"}>
					{`${done()}/${props.band.stories.length}`}
				</Badge>
				<Show when={props.onOpenChat}>
					{(openChat) => (
						<Button
							size="sm"
							emphasis="tertiary"
							onClick={() => openChat()(props.band.epicId)}
						>
							Chat
						</Button>
					)}
				</Show>
			</BoardTable.Band>
			<Show when={open()}>
				<For each={STATUSES}>
					{(status) => (
						<BandCell
							band={props.band}
							status={status}
							epics={props.epics}
							onOpen={props.onOpen}
						/>
					)}
				</For>
			</Show>
		</>
	);
}
