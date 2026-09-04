import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Dialog } from "@fcalell/plugin-solid-ui/components/dialog";
import {
	DropdownMenu,
	type MenuItem,
} from "@fcalell/plugin-solid-ui/components/dropdown-menu";
import { Row } from "@fcalell/plugin-solid-ui/components/row";
import { Stack } from "@fcalell/plugin-solid-ui/components/stack";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { Tooltip } from "@fcalell/plugin-solid-ui/components/tooltip";
import { createResource, createSignal, Show } from "solid-js";
import { api } from "../lib/api.ts";
import { boardStore, sortedShaping } from "../lib/board-store.ts";
import { formatTokens } from "../lib/format.ts";
import { meterStore } from "../lib/meter-store.ts";
import { dequeueRun, spawnShapeSession } from "../lib/session-store.ts";
import { AppBar } from "../ui/app-bar.tsx";
import { StatusDot } from "../ui/status-dot.tsx";
import type { ShapingTarget } from "./shaping-drawer.tsx";

interface BoardHeaderProps {
	connected: boolean;
	onNewEpic: () => void;
	onOpenShaping: (target: ShapingTarget) => void;
}

function ShapeEntry(props: {
	onOpenShaping: (target: ShapingTarget) => void;
	onNewEpic: () => void;
}) {
	const [dialogOpen, setDialogOpen] = createSignal(false);
	const [goal, setGoal] = createSignal("");
	const [spawning, setSpawning] = createSignal(false);

	async function start(): Promise<void> {
		const text = goal().trim();
		if (text === "") return;
		setSpawning(true);
		try {
			const sessionId = await spawnShapeSession(text);
			setDialogOpen(false);
			setGoal("");
			props.onOpenShaping({ sessionId });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "failed to start shaping",
			);
		} finally {
			setSpawning(false);
		}
	}

	// The single primary control: past chats to resume are labelled and split
	// from the start actions so they never read as plain menu commands.
	const items = (): MenuItem[] => {
		const threads = sortedShaping(boardStore.shaping);
		return [
			...(threads.length > 0
				? [
						{ type: "label" as const, label: "Resume a chat" },
						...threads.map((thread) => ({
							label: thread.title || thread.slug,
							onSelect: () => props.onOpenShaping({ slug: thread.slug }),
						})),
						{ type: "separator" as const },
					]
				: []),
			{ type: "label" as const, label: "Start" },
			{ label: "Shape a goal…", onSelect: () => setDialogOpen(true) },
			{ label: "New epic…", onSelect: () => props.onNewEpic() },
		];
	};

	return (
		<>
			<DropdownMenu
				trigger={
					<Button size="sm" emphasis="secondary">
						Shape
					</Button>
				}
				items={items()}
			/>
			<Dialog open={dialogOpen()} onOpenChange={setDialogOpen}>
				<Dialog.Content>
					<Dialog.Header>
						<Dialog.Title>New shaping chat</Dialog.Title>
						<Dialog.Description>
							Describe the rough goal; the chat shapes it into epics.
						</Dialog.Description>
					</Dialog.Header>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void start();
						}}
					>
						<Stack>
							<Textarea
								rows={4}
								value={goal()}
								onInput={(event) => setGoal(event.currentTarget.value)}
								placeholder="What should this feature or roadmap slice achieve?"
								aria-label="Rough goal"
							/>
							<div class="self-end">
								<Button
									type="submit"
									disabled={spawning() || goal().trim() === ""}
								>
									{spawning() ? "Starting…" : "Start shaping"}
								</Button>
							</div>
						</Stack>
					</form>
				</Dialog.Content>
			</Dialog>
		</>
	);
}

function formatReset(resetsAt: number): string {
	return new Date(resetsAt * 1000).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}

// Dispatcher occupancy: `queue R/C` plus `+N` waiting, with a dropdown
// listing each entry; queued run entries carry the cancel action.
function QueueStatus() {
	const queue = () => meterStore.snapshot?.queue;
	const label = () => {
		const current = queue();
		if (current === undefined) return "queue 0/1";
		const waiting = current.queued.length;
		return `queue ${current.running.length}/${current.cap}${
			waiting > 0 ? ` +${waiting}` : ""
		}`;
	};
	const items = (): MenuItem[] => {
		const current = queue();
		if (current === undefined) return [];
		const name = (entry: { kind: string; storyId?: string }) =>
			entry.storyId === undefined
				? entry.kind
				: `${entry.kind} ${entry.storyId}`;
		return [
			...current.running.map((entry) => ({
				label: `${name(entry)} · running`,
				disabled: true,
			})),
			...current.queued.map((entry) => {
				const storyId = entry.storyId;
				if (entry.kind !== "run" || storyId === undefined) {
					return { label: `${name(entry)} · queued`, disabled: true };
				}
				return {
					label: `${name(entry)} · cancel`,
					onSelect: () => void dequeueRun(storyId),
				};
			}),
		];
	};
	return (
		<Show
			when={items().length > 0}
			fallback={
				<Text as="span" variant="micro" tone="ink-3">
					{label()}
				</Text>
			}
		>
			<DropdownMenu
				trigger={
					<Button size="sm" emphasis="tertiary">
						{label()}
					</Button>
				}
				items={items()}
			/>
		</Show>
	);
}

// The rate-limit meter: lower-bound token sums with the 5-hour window's reset
// clock; a non-`allowed` status renders in the danger tone (display only).
function RateMeter() {
	const fiveHour = () =>
		meterStore.snapshot?.windows.find(
			(window) => window.windowType === "five_hour",
		);
	const limited = () =>
		meterStore.snapshot?.windows.some(
			(window) => window.status !== "allowed",
		) === true;
	const text = () => {
		const snapshot = meterStore.snapshot;
		if (snapshot === undefined) return "rate";
		const reset = fiveHour();
		const clock =
			reset === undefined ? "" : ` · resets ${formatReset(reset.resetsAt)}`;
		return `${formatTokens(snapshot.tokens.fiveHour)}/5h${clock} · ${formatTokens(
			snapshot.tokens.week,
		)}/7d`;
	};
	return (
		<Tooltip>
			<Tooltip.Trigger as="span">
				<Text as="span" variant="micro" tone={limited() ? "danger" : "ink-3"}>
					{text()}
				</Text>
			</Tooltip.Trigger>
			<Tooltip.Content>
				{limited()
					? "Rate limited; sends still burn the shared pool"
					: "Lower-bound token estimate: 5-hour window · trailing 7 days"}
			</Tooltip.Content>
		</Tooltip>
	);
}

export function BoardHeader(props: BoardHeaderProps) {
	const [repo] = createResource(() => api.repo.get());

	return (
		<AppBar>
			<Row>
				<Text as="span" variant="h3">
					Helm
				</Text>
				<Show when={repo()}>
					{(info) => (
						<>
							<Badge>{info().name}</Badge>
							<Text as="span" variant="caption" tone="ink-3">
								{info().branch}
							</Text>
						</>
					)}
				</Show>
			</Row>
			<Row>
				<ShapeEntry
					onOpenShaping={props.onOpenShaping}
					onNewEpic={props.onNewEpic}
				/>
				<QueueStatus />
				<RateMeter />
				<Tooltip>
					<Tooltip.Trigger as="span">
						<StatusDot ok={props.connected} />
					</Tooltip.Trigger>
					<Tooltip.Content>
						{props.connected ? "Live" : "Reconnecting"}
					</Tooltip.Content>
				</Tooltip>
			</Row>
		</AppBar>
	);
}
