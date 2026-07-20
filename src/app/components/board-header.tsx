import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Dialog } from "@fcalell/plugin-solid-ui/components/dialog";
import {
	DropdownMenu,
	type MenuItem,
} from "@fcalell/plugin-solid-ui/components/dropdown-menu";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { Tooltip } from "@fcalell/plugin-solid-ui/components/tooltip";
import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { createResource, createSignal, Show } from "solid-js";
import { api } from "../lib/api.ts";
import { boardStore, sortedShaping } from "../lib/board-store.ts";
import { meterStore } from "../lib/meter-store.ts";
import { dequeueRun, spawnShapeSession } from "../lib/session-store.ts";
import type { ShapingTarget } from "./shaping-drawer.tsx";

interface BoardHeaderProps {
	connected: boolean;
	onOpenShaping: (target: ShapingTarget) => void;
}

function ShapeEntry(props: { onOpenShaping: (target: ShapingTarget) => void }) {
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

	return (
		<>
			<DropdownMenu
				trigger={
					<Button size="sm" variant="outline">
						Shape
					</Button>
				}
				items={[
					...sortedShaping(boardStore.shaping).map((thread) => ({
						label: thread.title || thread.slug,
						onSelect: () => props.onOpenShaping({ slug: thread.slug }),
					})),
					{
						label: "New shaping chat…",
						onSelect: () => setDialogOpen(true),
					},
				]}
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
						class="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							void start();
						}}
					>
						<Textarea
							rows={4}
							value={goal()}
							onInput={(event) => setGoal(event.currentTarget.value)}
							placeholder="What should this feature or roadmap slice achieve?"
							aria-label="Rough goal"
						/>
						<Button
							type="submit"
							class="self-end"
							disabled={spawning() || goal().trim() === ""}
						>
							{spawning() ? "Starting…" : "Start shaping"}
						</Button>
					</form>
				</Dialog.Content>
			</Dialog>
		</>
	);
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
	return String(tokens);
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
			fallback={<span class="text-xs text-muted-foreground">{label()}</span>}
		>
			<DropdownMenu
				trigger={
					<Button
						size="sm"
						variant="ghost"
						class="text-xs text-muted-foreground"
					>
						{label()}
					</Button>
				}
				items={items()}
			/>
		</Show>
	);
}

// The rate-limit meter: lower-bound token sums with the 5-hour window's reset
// clock; a non-`allowed` status renders destructive (display only).
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
			<Tooltip.Trigger
				as="span"
				class={cn(
					"text-xs",
					limited() ? "text-destructive" : "text-muted-foreground",
				)}
			>
				{text()}
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
		<header class="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
			<div class="flex items-center gap-3">
				<span class="text-lg font-bold tracking-tight text-foreground">
					Helm
				</span>
				<Show when={repo()}>
					{(info) => (
						<div class="flex items-center gap-2">
							<Badge variant="secondary">{info().name}</Badge>
							<span class="text-sm text-muted-foreground">{info().branch}</span>
						</div>
					)}
				</Show>
			</div>
			<div class="flex items-center gap-4">
				<ShapeEntry onOpenShaping={props.onOpenShaping} />
				<QueueStatus />
				<RateMeter />
				<Tooltip>
					<Tooltip.Trigger
						as="div"
						class={cn(
							"size-2.5 rounded-full",
							props.connected ? "bg-success" : "bg-destructive",
						)}
					/>
					<Tooltip.Content>
						{props.connected ? "Live" : "Reconnecting"}
					</Tooltip.Content>
				</Tooltip>
			</div>
		</header>
	);
}
