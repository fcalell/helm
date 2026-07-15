import { createWsClient } from "@fcalell/plugin-node/client";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createStore, reconcile } from "solid-js/store";
import type {
	Board,
	BoardEvent,
	Epic,
	Status,
	Story,
} from "../../board/schema.ts";
import { canTransition } from "../../board/transitions.ts";
import { boardChannel } from "../../shared/channels.ts";
import { api } from "./api.ts";

export interface BoardState {
	epics: Record<string, Epic>;
	stories: Record<string, Story>;
	invalid: Record<string, string>;
	connected: boolean;
}

export const STATUS_LABELS: Record<Status, string> = {
	backlog: "Backlog",
	refining: "Refining",
	ready: "Ready",
	running: "Running",
	"needs-input": "Needs input",
	review: "Review",
	done: "Done",
	blocked: "Blocked",
};

const [store, setStore] = createStore<BoardState>({
	epics: {},
	stories: {},
	invalid: {},
	connected: false,
});

export const boardStore = store;

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
	const record: Record<string, T> = {};
	for (const item of items) record[item.id] = item;
	return record;
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
	const { [key]: _removed, ...rest } = record;
	return rest;
}

function applySnapshot(board: Board): void {
	setStore("epics", reconcile(byId(board.epics)));
	setStore("stories", reconcile(byId(board.stories)));
	const invalid: Record<string, string> = {};
	for (const file of board.invalid) invalid[file.path] = file.message;
	setStore("invalid", reconcile(invalid));
}

function applyEvent(event: BoardEvent): void {
	switch (event.kind) {
		case "epic-added":
		case "epic-changed":
			setStore("epics", event.epic.id, event.epic);
			return;
		case "epic-removed":
			setStore("epics", reconcile(omit(store.epics, event.id)));
			return;
		case "story-added":
			setStore("stories", event.story.id, event.story);
			return;
		case "story-changed":
			setStore("stories", event.story.id, event.story);
			if (event.illegalTransition) {
				toast.error(`Illegal hand edit: ${event.illegalTransition.reason}`);
			}
			return;
		case "story-removed":
			setStore("stories", reconcile(omit(store.stories, event.id)));
			return;
		case "file-invalid":
			setStore("invalid", event.path, event.message);
			return;
		case "invalid-cleared":
			setStore("invalid", reconcile(omit(store.invalid, event.path)));
			return;
		case "watch-error":
			toast.error(event.message);
			return;
	}
}

let started = false;

// Idempotent so the page component can call this unconditionally without
// risking a second socket on re-render.
export function connectBoard(): void {
	if (started) return;
	started = true;
	const client = createWsClient();
	client.subscribe(boardChannel, {
		onMessage: {
			snapshot: applySnapshot,
			event: applyEvent,
		},
		onStatus: (status) => setStore("connected", status === "open"),
	});
}

export function moveStory(id: string, to: Status): void {
	const story = store.stories[id];
	if (!story) return;

	const check = canTransition(story.frontmatter.status, to, story.brief);
	if (!check.ok) {
		toast.error(check.reason);
		return;
	}

	const previousStatus = story.frontmatter.status;
	setStore("stories", id, "frontmatter", "status", to);
	api.story.move({ id, to }).catch((error: unknown) => {
		setStore("stories", id, "frontmatter", "status", previousStatus);
		toast.error(
			error instanceof Error ? error.message : "failed to move story",
		);
	});
}

export function sortedEpics(epics: Record<string, Epic>): Epic[] {
	return Object.values(epics).sort((a, b) => a.id.localeCompare(b.id));
}

export function sortedStories(stories: Story[]): Story[] {
	return [...stories].sort((a, b) => a.id.localeCompare(b.id));
}

export function storiesByStatus(
	stories: Record<string, Story>,
	status: Status,
): Story[] {
	return sortedStories(
		Object.values(stories).filter(
			(story) => story.frontmatter.status === status,
		),
	);
}

export function epicProgress(
	epicId: string,
	stories: Record<string, Story>,
): { total: number; done: number } {
	const owned = Object.values(stories).filter(
		(story) => story.epicId === epicId,
	);
	return {
		total: owned.length,
		done: owned.filter((story) => story.frontmatter.status === "done").length,
	};
}

// Epic ids that appear on stories but have no matching epic file, sorted for
// a stable lane order. Board grid and the keyboard flat order both need this
// to agree on layout.
export function orphanEpicIds(
	epics: Record<string, Epic>,
	stories: Record<string, Story>,
): string[] {
	const ids = new Set<string>();
	for (const story of Object.values(stories)) {
		if (!(story.epicId in epics)) ids.add(story.epicId);
	}
	return [...ids].sort((a, b) => a.localeCompare(b));
}
