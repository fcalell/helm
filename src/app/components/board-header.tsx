import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Dialog } from "@fcalell/plugin-solid-ui/components/dialog";
import { DropdownMenu } from "@fcalell/plugin-solid-ui/components/dropdown-menu";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { Tooltip } from "@fcalell/plugin-solid-ui/components/tooltip";
import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { createResource, createSignal, Show } from "solid-js";
import { api } from "../lib/api.ts";
import { boardStore, sortedShaping } from "../lib/board-store.ts";
import { spawnShapeSession } from "../lib/session-store.ts";
import type { ShapingTarget } from "./shaping-drawer.tsx";

interface BoardHeaderProps {
	connected: boolean;
	onOpenShaping: (target: ShapingTarget) => void;
}

// The board-level shaping entry: reopen an existing thread or seed a new
// shape session with a rough goal.
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
				<span class="text-xs text-muted-foreground">queue 0/1</span>
				<Tooltip>
					<Tooltip.Trigger as="span" class="text-xs text-muted-foreground">
						rate limit
					</Tooltip.Trigger>
					<Tooltip.Content>Arrives with runs</Tooltip.Content>
				</Tooltip>
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
