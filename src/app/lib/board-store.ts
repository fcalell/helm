import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createStore, reconcile } from "solid-js/store";
import type {
	Board,
	Epic,
	Notice,
	ShapingThread,
	Status,
	Story,
} from "../../board/schema.ts";
import {
	canTransition,
	checkReadyGate,
	verdictValid,
} from "../../board/transitions.ts";
import { boardChannel } from "../../shared/channels.ts";
import type { GatePhase } from "../../shared/gate.ts";
import { api } from "./api.ts";
import { PHASE_LINES } from "./gate-store.ts";
import { wsClient } from "./ws.ts";

export interface BoardState {
	epics: Record<string, Epic>;
	stories: Record<string, Story>;
	// Shaping threads keyed by slug.
	shaping: Record<string, ShapingThread>;
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
	shaping: {},
	invalid: {},
	connected: false,
});

export const boardStore = store;

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
	const record: Record<string, T> = {};
	for (const item of items) record[item.id] = item;
	return record;
}

// In-flight optimistic moves, `id -> target status`. Every snapshot is applied
// with these overlaid so a snapshot the watcher built before an in-flight
// write (it trails disk by the ~250ms awaitWriteFinish window) cannot bounce
// the dragged card back. An entry clears when a snapshot confirms it reached
// the target, or when its RPC rejects (the optimism is reverted).
const pendingMoves = new Map<string, Status>();

function applySnapshot(board: Board): void {
	const stories = byId(board.stories);
	for (const [id, to] of pendingMoves) {
		const story = stories[id];
		if (story === undefined) continue;
		if (story.frontmatter.status === to) {
			pendingMoves.delete(id);
			continue;
		}
		stories[id] = {
			...story,
			frontmatter: { ...story.frontmatter, status: to },
		};
	}
	setStore("epics", reconcile(byId(board.epics)));
	setStore("stories", reconcile(stories));
	const shaping: Record<string, ShapingThread> = {};
	for (const thread of board.shaping) shaping[thread.slug] = thread;
	setStore("shaping", reconcile(shaping));
	const invalid: Record<string, string> = {};
	for (const file of board.invalid) invalid[file.path] = file.message;
	setStore("invalid", reconcile(invalid));
}

function applyNotice(notice: Notice): void {
	toast.error(notice.message);
}

let started = false;

// Idempotent so the page component can call this unconditionally without
// risking a second socket on re-render.
export function connectBoard(): void {
	if (started) return;
	started = true;
	wsClient().subscribe(boardChannel, {
		onMessage: {
			snapshot: applySnapshot,
			notice: applyNotice,
		},
		onStatus: (status) => setStore("connected", status === "open"),
	});
}

// The move landed the story in the ready gate instead of Ready: the round is
// the feedback, so name the phase it sits in.
function gatingToast(id: string, phase: Exclude<GatePhase, "exhausted">): void {
	toast.info(`${id}: ${PHASE_LINES[phase]}`);
}

export function moveStory(id: string, to: Status): void {
	const story = store.stories[id];
	if (!story) {
		toast.error(`${id} is no longer on the board`);
		return;
	}

	const from = story.frontmatter.status;
	const transitionStory = {
		brief: story.brief,
		body: story.body,
		gate: story.frontmatter.gate,
	};
	const check = canTransition(from, to, transitionStory);
	if (!check.ok) {
		const gates =
			to === "ready" &&
			from === "refining" &&
			checkReadyGate(story.brief).ok &&
			!verdictValid(story.frontmatter.gate, story.body);
		if (!gates) {
			toast.error(check.reason);
			return;
		}
		api.story
			.move({ id, to })
			.then((result) => {
				// The gate let the move through, so adopt the optimism now.
				if (!result.gating) {
					pendingMoves.set(id, to);
					setStore("stories", id, "frontmatter", "status", to);
					return;
				}
				gatingToast(id, result.phase);
			})
			.catch((error: unknown) => {
				toast.error(
					error instanceof Error ? error.message : "failed to move story",
				);
			});
		return;
	}

	pendingMoves.set(id, to);
	setStore("stories", id, "frontmatter", "status", to);
	api.story
		.move({ id, to })
		.then((result) => {
			// `gating: false` is already on screen; only a gating result has to
			// undo the optimism (the server's fresh read beat the snapshot the
			// client judged the transition on).
			if (!result.gating) return;
			pendingMoves.delete(id);
			setStore("stories", id, "frontmatter", "status", from);
			gatingToast(id, result.phase);
		})
		.catch((error: unknown) => {
			pendingMoves.delete(id);
			setStore("stories", id, "frontmatter", "status", from);
			toast.error(
				error instanceof Error ? error.message : "failed to move story",
			);
		});
}

export function sortedShaping(
	shaping: Record<string, ShapingThread>,
): ShapingThread[] {
	return Object.values(shaping).sort((a, b) => a.slug.localeCompare(b.slug));
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

// One band of the board grid: an epic (or an epic id stories name with no
// epic file behind it) and the stories it owns.
export interface EpicBand {
	epicId: string;
	title: string;
	// False on an orphan band: no epic file, so no define chat to open.
	hasEpic: boolean;
	stories: Story[];
	// Every owned story is done, so the band starts collapsed.
	completed: boolean;
}

// The board's bands in display order: epics with open work by id, then the
// orphan ids, then the completed epics.
export function epicBands(
	epics: Record<string, Epic>,
	stories: Record<string, Story>,
): EpicBand[] {
	const owned = new Map<string, Story[]>();
	for (const story of Object.values(stories)) {
		const list = owned.get(story.epicId) ?? [];
		list.push(story);
		owned.set(story.epicId, list);
	}
	const band = (epicId: string, title: string, hasEpic: boolean): EpicBand => {
		const own = sortedStories(owned.get(epicId) ?? []);
		return {
			epicId,
			title,
			hasEpic,
			stories: own,
			completed:
				own.length > 0 &&
				own.every((story) => story.frontmatter.status === "done"),
		};
	};
	const known = Object.values(epics)
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((epic) => band(epic.id, epic.title, true));
	const orphans = [...owned.keys()]
		.filter((epicId) => !(epicId in epics))
		.sort((a, b) => a.localeCompare(b))
		.map((epicId) => band(epicId, epicId, false));
	return [
		...known.filter((each) => !each.completed),
		...orphans,
		...known.filter((each) => each.completed),
	];
}
