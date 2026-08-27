import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Checkbox } from "@fcalell/plugin-solid-ui/components/checkbox";
import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import type { DecisionItem, ShapingThread } from "../../board/schema.ts";
import { api } from "../lib/api.ts";
import { boardStore } from "../lib/board-store.ts";
import { pendingDecisionFor, researchStateFor } from "../lib/session-store.ts";
import { ChatDrawer, ChatDrawerTitle } from "../ui/chat-drawer.tsx";
import { Struck } from "../ui/struck.tsx";
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

	// A live pending-decision widget owns this row's answer input; the panel
	// only badges it. Only after a restart drops the cache does the panel fall
	// back to its own resolve form.
	const widget = () => pendingDecisionFor(props.slug, props.decision.text);

	return (
		<li class="flex flex-col gap-pair">
			<div class="flex flex-wrap items-start gap-row">
				<Checkbox checked={false} disabled aria-label="Open decision" />
				<Text as="span" variant="caption">
					{props.decision.text}
				</Text>
				<Show when={props.decision.settledBy === "research"}>
					<Switch fallback={<Badge>research</Badge>}>
						<Match when={research()?.status === "pending"}>
							<Badge tone="interactive">researching…</Badge>
						</Match>
						<Match when={research()?.status === "failed"}>
							<Badge tone="danger">research failed</Badge>
						</Match>
					</Switch>
				</Show>
			</div>
			<Show when={research()?.error}>
				{(error) => (
					<Text variant="micro" tone="danger">
						{error()}
					</Text>
				)}
			</Show>
			<Show when={widget()}>
				<div class="flex self-start">
					<Badge tone="interactive">answer in chat</Badge>
				</div>
			</Show>
			<Show when={widget() === undefined && research()?.status !== "pending"}>
				<form
					class="flex gap-row"
					onSubmit={(event) => {
						event.preventDefault();
						void resolve();
					}}
				>
					<Input
						value={answer()}
						onInput={(event) => setAnswer(event.currentTarget.value)}
						placeholder="Settle it…"
						aria-label={`Answer to: ${props.decision.text}`}
					/>
					<Button
						type="submit"
						size="sm"
						emphasis="secondary"
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
			fallback={
				<Text variant="caption" tone="ink-3">
					No decisions raised yet.
				</Text>
			}
		>
			<ul class="flex flex-col gap-row">
				<For each={props.thread.decisions}>
					{(decision) => (
						<Show
							when={!decision.checked}
							fallback={
								<li class="flex items-start gap-row">
									<Checkbox checked disabled aria-label="Resolved decision" />
									<Struck>{decision.text}</Struck>
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
	target: ShapingTarget;
	onClose: () => void;
}

export function ShapingDrawer(props: ShapingDrawerProps) {
	const thread = (): ShapingThread | undefined => {
		const target = props.target;
		if (target.slug !== undefined) return boardStore.shaping[target.slug];
		return Object.values(boardStore.shaping).find(
			(each) => each.frontmatter.sessions.shape === target.sessionId,
		);
	};
	const sessionId = () =>
		props.target.sessionId ?? thread()?.frontmatter.sessions.shape;

	return (
		<ChatDrawer
			onClose={props.onClose}
			title={
				<>
					<ChatDrawerTitle>{thread()?.title ?? "Shaping"}</ChatDrawerTitle>
					<Badge>Shaping</Badge>
				</>
			}
		>
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
								fallback={
									<Text variant="caption" tone="ink-3">
										Waiting for the thread file…
									</Text>
								}
							>
								{(loaded) => <DecisionsChecklist thread={loaded()} />}
							</Show>
						}
					/>
				)}
			</Show>
		</ChatDrawer>
	);
}
