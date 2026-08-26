import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { Tooltip } from "@fcalell/plugin-solid-ui/components/tooltip";
import { createDraggable } from "@thisbeyond/solid-dnd";
import { createSignal, Match, Show, Switch } from "solid-js";
import type { Epic, Story } from "../../board/schema.ts";
import type { PermissionRequest } from "../../server/mcp/schemas.ts";
import { gateFor } from "../lib/gate-store.ts";
import { meterStore } from "../lib/meter-store.ts";
import {
	pendingPermission,
	resolveRunPermission,
	startStoryRun,
} from "../lib/session-store.ts";
import { BoardCard } from "../ui/board-card.tsx";
import { OneLine } from "../ui/one-line.tsx";
import { gateBadgeLabel, gateHistory } from "./gate-panel.tsx";

interface StoryCardProps {
	story: Story;
	epics: Record<string, Epic>;
	onOpen: () => void;
	onRefine: () => void;
}

function CardContents(props: { story: Story; epics: Record<string, Epic> }) {
	const epicLabel = () =>
		props.epics[props.story.epicId]?.slug ?? props.story.epicId;
	const criteria = () => props.story.brief.criteria;
	const checkedCount = () => criteria().filter((item) => item.checked).length;
	const openQuestions = () =>
		props.story.brief.openQuestions.filter((item) => !item.checked).length;
	const depends = () => props.story.frontmatter.depends;
	const isRefining = () => props.story.frontmatter.status === "refining";
	const gateBadge = () =>
		isRefining()
			? gateBadgeLabel(gateHistory(props.story), gateFor(props.story.id))
			: undefined;
	// The review close's diff stat, shown while the story sits in Review.
	const reviewStat = () =>
		props.story.frontmatter.status === "review"
			? props.story.frontmatter.runs.findLast((run) => run.stat !== undefined)
					?.stat
			: undefined;

	return (
		<>
			<Text variant="caption" strong>
				{props.story.brief.title || props.story.id}
			</Text>
			<div class="flex flex-wrap items-center gap-pair">
				<Badge>{epicLabel()}</Badge>
				<Show when={gateBadge()}>
					{(label) => (
						<Badge tone="warn" data-gate-badge>
							{label()}
						</Badge>
					)}
				</Show>
				<Show when={criteria().length > 0}>
					<Text as="span" variant="micro" tone="ink-3">
						{checkedCount() > 0
							? `${checkedCount()}/${criteria().length} criteria`
							: `${criteria().length} criteria`}
					</Text>
				</Show>
				<Show when={depends().length > 0}>
					<Tooltip>
						<Tooltip.Trigger as="span">
							<Text as="span" variant="micro" tone="ink-3">
								{`needs ${depends()[0]}`}
							</Text>
						</Tooltip.Trigger>
						<Tooltip.Content>{depends().join(", ")}</Tooltip.Content>
					</Tooltip>
				</Show>
				<Show when={isRefining() && openQuestions() > 0}>
					<Text as="span" variant="micro" tone="ink-3">
						{`${openQuestions()} open questions`}
					</Text>
				</Show>
				<Show when={reviewStat()}>
					{(stat) => (
						<Text as="span" variant="micro" tone="ink-3">
							{stat()}
						</Text>
					)}
				</Show>
			</div>
		</>
	);
}

// One-liner for a held tool call: Bash shows its command, file tools their
// path, anything else the tool name.
function permissionSummary(request: PermissionRequest): string {
	const input = request.input;
	const command = input.command;
	if (typeof command === "string") return `${request.toolName}: ${command}`;
	const filePath = input.file_path;
	if (typeof filePath === "string") {
		return `${request.toolName}: ${filePath}`;
	}
	return request.toolName;
}

// The card root is the drag-and-open surface, so this container isolates
// all three event paths: pointerdown (solid-dnd's activators listen there),
// click (the drawer open), and keydown (Enter/Space bubbling into open).
function PermissionPrompt(props: { request: PermissionRequest }) {
	return (
		<fieldset
			class="flex flex-col gap-pair"
			aria-label="Permission prompt"
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<OneLine title={permissionSummary(props.request)}>
				{permissionSummary(props.request)}
			</OneLine>
			<div class="flex gap-pair">
				<Button
					size="sm"
					emphasis="secondary"
					onClick={() => void resolveRunPermission(props.request.id, true)}
				>
					Approve
				</Button>
				<Button
					size="sm"
					emphasis="secondary"
					onClick={() => void resolveRunPermission(props.request.id, false)}
				>
					Deny
				</Button>
			</div>
		</fieldset>
	);
}

// The status-driven footer action. Same event isolation as PermissionPrompt:
// the card root owns pointerdown (drag), click (open), and keydown
// (Enter/Space open), and none of the three may fire from the button.
function CardAction(props: { story: Story; onRefine: () => void }) {
	const status = () => props.story.frontmatter.status;
	const [starting, setStarting] = createSignal(false);
	const queued = () =>
		meterStore.snapshot?.queue.queued.some(
			(entry) => entry.kind === "run" && entry.storyId === props.story.id,
		) === true;

	async function run(): Promise<void> {
		setStarting(true);
		try {
			await startStoryRun(props.story.id);
		} finally {
			setStarting(false);
		}
	}

	return (
		<Show
			when={
				status() === "backlog" ||
				status() === "refining" ||
				status() === "ready"
			}
		>
			<fieldset
				class="flex justify-end"
				aria-label="Story action"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<Switch>
					<Match when={status() === "backlog"}>
						<Button
							size="sm"
							emphasis="secondary"
							onClick={() => props.onRefine()}
						>
							Refine
						</Button>
					</Match>
					<Match when={status() === "refining"}>
						<Button
							size="sm"
							emphasis="secondary"
							onClick={() => props.onRefine()}
						>
							Chat
						</Button>
					</Match>
					<Match when={status() === "ready"}>
						<Button
							size="sm"
							emphasis="secondary"
							disabled={starting() || queued()}
							onClick={() => void run()}
						>
							{queued() ? "Queued" : "Run"}
						</Button>
					</Match>
				</Switch>
			</fieldset>
		</Show>
	);
}

// The DragOverlay clone. Deliberately not draggable: a second
// createDraggable with the same id inside the overlay corrupts solid-dnd's
// collision geometry (drops resolve one column off).
export function StoryCardOverlay(props: {
	story: Story;
	epics: Record<string, Epic>;
}) {
	return (
		<BoardCard interactive={false}>
			<CardContents story={props.story} epics={props.epics} />
		</BoardCard>
	);
}

export function StoryCard(props: StoryCardProps) {
	const isRunning = () => props.story.frontmatter.status === "running";

	// BoardCard forwards ref and rest to its root div, so the compiler-only
	// `use:draggable` directive form doesn't apply here; wiring the ref and
	// activators as plain props gets the same behavior.
	const draggable = createDraggable(props.story.id);

	return (
		<BoardCard
			ref={draggable.ref}
			{...draggable.dragActivators}
			data-story-id={props.story.id}
			role="button"
			tabIndex={0}
			running={isRunning()}
			dragging={draggable.isActiveDraggable}
			onClick={() => props.onOpen()}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				// Space would otherwise scroll the board.
				if (event.key === " ") event.preventDefault();
				props.onOpen();
			}}
		>
			<CardContents story={props.story} epics={props.epics} />
			<Show when={pendingPermission(props.story.id)}>
				{(request) => <PermissionPrompt request={request()} />}
			</Show>
			<CardAction story={props.story} onRefine={props.onRefine} />
		</BoardCard>
	);
}
