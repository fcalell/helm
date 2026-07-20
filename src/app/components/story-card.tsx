import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Card } from "@fcalell/plugin-solid-ui/components/card";
import { Tooltip } from "@fcalell/plugin-solid-ui/components/tooltip";
import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { createDraggable } from "@thisbeyond/solid-dnd";
import { Show } from "solid-js";
import type { Epic, Story } from "../../board/schema.ts";
import type { PermissionRequest } from "../../server/mcp/schemas.ts";
import { gateFor } from "../lib/gate-store.ts";
import {
	pendingPermission,
	resolveRunPermission,
} from "../lib/session-store.ts";
import { gateBadgeLabel } from "./gate-panel.tsx";

interface StoryCardProps {
	story: Story;
	epics: Record<string, Epic>;
	selected: boolean;
	onSelect: () => void;
	onOpen: () => void;
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
	const gate = () => (isRefining() ? gateFor(props.story.id) : undefined);
	// The review close's diff stat, shown while the story sits in Review.
	const reviewStat = () =>
		props.story.frontmatter.status === "review"
			? props.story.frontmatter.runs.findLast((run) => run.stat !== undefined)
					?.stat
			: undefined;

	return (
		<>
			<p class="text-sm font-semibold text-foreground">
				{props.story.brief.title || props.story.id}
			</p>
			<div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
				<Badge variant="outline">{epicLabel()}</Badge>
				<Show when={gate()}>
					{(attempt) => (
						<Badge variant="warning" data-gate-badge>
							{gateBadgeLabel(attempt())}
						</Badge>
					)}
				</Show>
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
				<Show when={reviewStat()}>{(stat) => <span>{stat()}</span>}</Show>
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

// The card root is the drag-and-select surface, so this container isolates
// all three event paths: pointerdown (solid-dnd's activators listen there),
// click (the drawer open), and keydown (Enter/Space bubbling into select).
function PermissionPrompt(props: { request: PermissionRequest }) {
	return (
		<fieldset
			class="flex flex-col gap-1.5 rounded-md border border-warning/50 bg-muted/40 p-2"
			aria-label="Permission prompt"
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<p class="break-all font-mono text-xs text-foreground">
				{permissionSummary(props.request)}
			</p>
			<div class="flex gap-1.5">
				<Button
					size="sm"
					variant="secondary"
					onClick={() => void resolveRunPermission(props.request.id, true)}
				>
					Approve
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => void resolveRunPermission(props.request.id, false)}
				>
					Deny
				</Button>
			</div>
		</fieldset>
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
		<Card class="gap-2 p-3 shadow-lg">
			<CardContents story={props.story} epics={props.epics} />
		</Card>
	);
}

export function StoryCard(props: StoryCardProps) {
	const isRunning = () => props.story.frontmatter.status === "running";

	// Card is a custom component (forwards ref/rest to its root div), so the
	// compiler-only `use:draggable` directive form doesn't apply here; wiring
	// the ref and activators as plain props gets the same behavior.
	const draggable = createDraggable(props.story.id);

	return (
		<Card
			ref={draggable.ref}
			{...draggable.dragActivators}
			data-story-id={props.story.id}
			role="button"
			tabIndex={0}
			onClick={() => {
				props.onSelect();
				props.onOpen();
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				// Space would otherwise scroll the board.
				if (event.key === " ") event.preventDefault();
				props.onSelect();
				props.onOpen();
			}}
			class={cn(
				"cursor-pointer gap-2 p-3 transition-shadow duration-base ease-ui",
				props.selected && "ring-2 ring-ring",
				isRunning() && "helm-card-pulse",
				draggable.isActiveDraggable && "opacity-40",
			)}
		>
			<CardContents story={props.story} epics={props.epics} />
			<Show when={pendingPermission(props.story.id)}>
				{(request) => <PermissionPrompt request={request()} />}
			</Show>
		</Card>
	);
}
