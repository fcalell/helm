import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import "../app.css";
import { STATUSES } from "../../board/schema.ts";
import { BoardGrid } from "../components/board-grid.tsx";
import { BoardHeader } from "../components/board-header.tsx";
import { CardDrawer } from "../components/card-drawer.tsx";
import { InvalidBanner } from "../components/invalid-banner.tsx";
import {
	boardStore,
	connectBoard,
	orphanEpicIds,
	sortedEpics,
	storiesByStatus,
} from "../lib/board-store.ts";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.isContentEditable
	);
}

export default function Home() {
	const [selectedStoryId, setSelectedStoryId] = createSignal<string | null>(
		null,
	);
	const [drawerOpen, setDrawerOpen] = createSignal(false);
	const [epicView, setEpicView] = createSignal(false);

	connectBoard();

	function openStory(id: string): void {
		setSelectedStoryId(id);
		setDrawerOpen(true);
	}

	function flatStoryOrder(): string[] {
		if (!epicView()) {
			return STATUSES.flatMap((status) =>
				storiesByStatus(boardStore.stories, status).map((story) => story.id),
			);
		}
		const laneIds = [
			...sortedEpics(boardStore.epics).map((epic) => epic.id),
			...orphanEpicIds(boardStore.epics, boardStore.stories),
		];
		return laneIds.flatMap((epicId) =>
			STATUSES.flatMap((status) =>
				storiesByStatus(boardStore.stories, status)
					.filter((story) => story.epicId === epicId)
					.map((story) => story.id),
			),
		);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (isTypingTarget(event.target)) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		if (event.key === "e") {
			setEpicView((value) => !value);
			return;
		}
		if (event.key === "Escape") {
			setDrawerOpen(false);
			return;
		}
		if (event.key === "Enter") {
			if (selectedStoryId()) setDrawerOpen(true);
			return;
		}
		if (event.key !== "j" && event.key !== "k") return;

		const order = flatStoryOrder();
		if (order.length === 0) return;
		const currentId = selectedStoryId();
		const currentIndex = currentId ? order.indexOf(currentId) : -1;
		const nextIndex =
			event.key === "j"
				? Math.min(currentIndex < 0 ? 0 : currentIndex + 1, order.length - 1)
				: Math.max(currentIndex < 0 ? 0 : currentIndex - 1, 0);
		const nextId = order[nextIndex];
		if (nextId) setSelectedStoryId(nextId);
	}

	onMount(() => {
		window.addEventListener("keydown", handleKeydown);
	});
	onCleanup(() => {
		window.removeEventListener("keydown", handleKeydown);
	});

	createEffect(() => {
		const id = selectedStoryId();
		if (!id) return;
		document
			.querySelector(`[data-story-id="${id}"]`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	});

	const selectedStory = () => {
		const id = selectedStoryId();
		return id ? boardStore.stories[id] : undefined;
	};

	return (
		<div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<BoardHeader connected={boardStore.connected} />
			<InvalidBanner invalid={boardStore.invalid} />
			<BoardGrid
				epics={boardStore.epics}
				stories={boardStore.stories}
				epicView={epicView()}
				selectedStoryId={selectedStoryId()}
				onSelect={setSelectedStoryId}
				onOpen={openStory}
			/>
			<CardDrawer
				story={selectedStory()}
				open={drawerOpen()}
				onOpenChange={setDrawerOpen}
			/>
		</div>
	);
}
