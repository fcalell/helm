import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Checkbox } from "@fcalell/plugin-solid-ui/components/checkbox";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { Sheet } from "@fcalell/plugin-solid-ui/components/sheet";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import type { DecisionItem, ShapingThread } from "../../board/schema.ts";
import { api } from "../lib/api.ts";
import { boardStore } from "../lib/board-store.ts";
import { researchStateFor } from "../lib/session-store.ts";
import { ChatPane } from "./chat-pane.tsx";

// The drawer target right after a fresh spawn carries only the session id;
// the thread (and its slug) appears with the watcher's next snapshot.
export interface ShapingTarget {
	slug?: string;
	sessionId?: string;
}

function OpenDecision(props: { slug: string; decision: DecisionItem }) {
	const [answer, setAnswer] = createSignal("");
	const [inFlight, setInFlight] = createSignal(false);

	async function resolve(): Promise<void> {
		const text = answer().trim();
		if (text === "") return;
		setInFlight(true);
		try {
			await api.shaping.resolveDecision({
				slug: props.slug,
				decision: props.decision.text,
				answer: text,
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "failed to resolve decision",
			);
		} finally {
			setInFlight(false);
		}
	}

	const research = () =>
		props.decision.settledBy === "research"
			? researchStateFor(props.slug, props.decision.text)
			: undefined;

	return (
		<li class="flex flex-col gap-1.5">
			<div class="flex items-start gap-2">
				<Checkbox checked={false} disabled aria-label="Open decision" />
				<span class="text-sm">{props.decision.text}</span>
				<Show when={props.decision.settledBy === "research"}>
					<Switch fallback={<Badge variant="outline">research</Badge>}>
						<Match when={research()?.status === "pending"}>
							<Badge variant="secondary">researching…</Badge>
						</Match>
						<Match when={research()?.status === "failed"}>
							<Badge variant="destructive">research failed</Badge>
						</Match>
					</Switch>
				</Show>
			</div>
			<Show when={research()?.error}>
				{(error) => <p class="ml-6 text-xs text-destructive">{error()}</p>}
			</Show>
			<Show when={research()?.status !== "pending"}>
				<form
					class="ml-6 flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void resolve();
					}}
				>
					<Input
						size="sm"
						value={answer()}
						onInput={(event) => setAnswer(event.currentTarget.value)}
						placeholder="Settle it…"
						aria-label={`Answer to: ${props.decision.text}`}
					/>
					<Button
						type="submit"
						size="sm"
						variant="outline"
						disabled={inFlight() || answer().trim() === ""}
					>
						Resolve
					</Button>
				</form>
			</Show>
		</li>
	);
}

function DecisionsChecklist(props: { thread: ShapingThread }) {
	return (
		<Show
			when={props.thread.decisions.length > 0}
			fallback={<p>No decisions raised yet.</p>}
		>
			<ul class="flex flex-col gap-2">
				<For each={props.thread.decisions}>
					{(decision) => (
						<Show
							when={!decision.checked}
							fallback={
								<li class="flex items-start gap-2">
									<Checkbox checked disabled aria-label="Resolved decision" />
									<span class="text-sm text-muted-foreground line-through">
										{decision.text}
									</span>
								</li>
							}
						>
							<OpenDecision slug={props.thread.slug} decision={decision} />
						</Show>
					)}
				</For>
			</ul>
		</Show>
	);
}

export interface ShapingDrawerProps {
	target: ShapingTarget | null;
	onOpenChange: (open: boolean) => void;
}

export function ShapingDrawer(props: ShapingDrawerProps) {
	const thread = (): ShapingThread | undefined => {
		const target = props.target;
		if (target === null) return undefined;
		if (target.slug !== undefined) return boardStore.shaping[target.slug];
		return Object.values(boardStore.shaping).find(
			(each) => each.frontmatter.sessions.shape === target.sessionId,
		);
	};
	const sessionId = () =>
		props.target?.sessionId ?? thread()?.frontmatter.sessions.shape;

	return (
		<Sheet open={props.target !== null} onOpenChange={props.onOpenChange}>
			<Sheet.Content
				position="right"
				size="xl"
				class="flex flex-col overflow-hidden"
			>
				<Sheet.Header class="shrink-0">
					<div class="flex items-center gap-2">
						<Sheet.Title>{thread()?.title ?? "Shaping"}</Sheet.Title>
						<Badge>Shaping</Badge>
					</div>
				</Sheet.Header>
				<div class="mt-4 min-h-0 flex-1">
					<Show
						when={sessionId()}
						fallback={
							<EmptyState
								title="Shaping chat"
								description="No shape session is attached to this thread."
							/>
						}
					>
						{(id) => (
							<ChatPane
								sessionId={id()}
								artifactTitle="Decisions"
								artifact={
									<Show
										when={thread()}
										fallback={<p>Waiting for the thread file…</p>}
									>
										{(loaded) => <DecisionsChecklist thread={loaded()} />}
									</Show>
								}
							/>
						)}
					</Show>
				</div>
			</Sheet.Content>
		</Sheet>
	);
}
