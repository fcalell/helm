import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Card } from "@fcalell/plugin-solid-ui/components/card";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import type { BadgeTone } from "@fcalell/ui-core/variants";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import type {
	GateFlagStatus,
	GateRecordRound,
	Story,
} from "../../board/schema.ts";
import type { GateAttempt, GateFlag } from "../../shared/gate.ts";
import { gateFor, PHASE_LINES, resolveGateFlag } from "../lib/gate-store.ts";
import { Eyebrow } from "../ui/eyebrow.tsx";
import { Prose } from "../ui/prose.tsx";

const FLAG_BADGES: Record<GateFlagStatus, { label: string; tone: BadgeTone }> =
	{
		open: { label: "Open", tone: "neutral" },
		fixed: { label: "Fixed", tone: "ok" },
		contested: { label: "Contested", tone: "warn" },
		accepted: { label: "Open question", tone: "warn" },
		dismissed: { label: "Dismissed", tone: "danger" },
	};

// A contested flag: the adversary's finding plus the refine session's
// counter-argument, resolved only by the user.
function FlagWidget(props: { storyId: string; flag: GateFlag }) {
	const [dismissing, setDismissing] = createSignal(false);
	const [reason, setReason] = createSignal("");
	const [inFlight, setInFlight] = createSignal(false);

	async function resolve(
		resolution: Parameters<typeof resolveGateFlag>[2],
	): Promise<void> {
		setInFlight(true);
		try {
			await resolveGateFlag(props.storyId, props.flag.title, resolution);
			setDismissing(false);
		} catch {
			// toasted by the store; keep the form open for a retry
		} finally {
			setInFlight(false);
		}
	}

	return (
		<Card ring="warn" data-gate-flag={props.flag.title}>
			<div class="flex items-center gap-row">
				<Eyebrow>Risk flag</Eyebrow>
				<Badge tone="warn">Contested</Badge>
			</div>
			<Text variant="caption" strong>
				{props.flag.title}
			</Text>
			<Prose variant="caption" tone="ink-3">
				{props.flag.detail}
			</Prose>
			<Show
				when={props.flag.argument}
				fallback={
					<Prose variant="caption" tone="ink-3" italic>
						The refine chat left this flag unanswered.
					</Prose>
				}
			>
				{(argument) => (
					<Prose variant="caption">Counter-argument: {argument()}</Prose>
				)}
			</Show>
			<Show
				when={dismissing()}
				fallback={
					<div class="flex gap-row">
						<Button
							size="sm"
							disabled={inFlight()}
							onClick={() => void resolve({ type: "accept" })}
						>
							File as open question
						</Button>
						<Button
							size="sm"
							emphasis="secondary"
							disabled={inFlight()}
							onClick={() => setDismissing(true)}
						>
							Dismiss
						</Button>
					</div>
				}
			>
				<form
					class="flex flex-col gap-row"
					onSubmit={(event) => {
						event.preventDefault();
						if (reason().trim() === "") return;
						void resolve({ type: "dismiss", reason: reason().trim() });
					}}
				>
					<Textarea
						rows={2}
						value={reason()}
						onInput={(event) => setReason(event.currentTarget.value)}
						placeholder="Why is this risk accepted?"
						aria-label="Override reason"
					/>
					<div class="flex gap-row">
						<Button
							type="submit"
							size="sm"
							tone="danger"
							disabled={inFlight() || reason().trim() === ""}
						>
							Dismiss flag
						</Button>
						<Button
							type="button"
							size="sm"
							emphasis="tertiary"
							onClick={() => setDismissing(false)}
						>
							Cancel
						</Button>
					</div>
				</form>
			</Show>
		</Card>
	);
}

// The story file's round record: every round the gate has spent on this brief,
// with each flag at its last known status.
function RoundHistory(props: { rounds: GateRecordRound[] }) {
	return (
		<div class="flex flex-col gap-row">
			<For each={props.rounds}>
				{(round) => (
					<div class="flex flex-col gap-pair">
						<Eyebrow>Round {round.n}</Eyebrow>
						<ul class="flex flex-col gap-pair">
							<For each={round.flags}>
								{(flag) => (
									<li class="flex items-center gap-row">
										<Badge tone={FLAG_BADGES[flag.status].tone}>
											{FLAG_BADGES[flag.status].label}
										</Badge>
										<Text as="span" variant="caption">
											{flag.title}
										</Text>
									</li>
								)}
							</For>
						</ul>
					</div>
				)}
			</For>
		</div>
	);
}

// The rounds a refining story has already spent, whether or not an attempt is
// still in memory.
export function gateHistory(story: Story): GateRecordRound[] {
	if (story.frontmatter.status !== "refining") return [];
	return story.frontmatter.gate?.rounds ?? [];
}

export function GatePanel(props: { story: Story }) {
	const attempt = () => gateFor(props.story.id);
	const contested = () =>
		(attempt()?.rounds.at(-1)?.flags ?? []).filter(
			(flag) => flag.status === "contested",
		);
	const history = () => gateHistory(props.story);
	return (
		<Show when={attempt() !== undefined || history().length > 0}>
			<div class="flex shrink-0 flex-col">
				<Card data-gate-phase={attempt()?.phase}>
					<Show when={attempt()}>
						{(active) => (
							<>
								<Switch
									fallback={
										<Text variant="caption" tone="ink-3">
											{PHASE_LINES[active().phase]}
										</Text>
									}
								>
									<Match
										when={
											active().phase === "queued" ||
											active().phase === "adversary"
										}
									>
										<Loader text={PHASE_LINES[active().phase]} />
									</Match>
								</Switch>
								<For each={contested()}>
									{(flag) => (
										<FlagWidget storyId={props.story.id} flag={flag} />
									)}
								</For>
							</>
						)}
					</Show>
					<Show when={history().length > 0}>
						<RoundHistory rounds={history()} />
					</Show>
					<Show when={attempt()?.phase === "exhausted"}>
						<Text variant="micro" tone="ink-3">
							Move the card to Ready to run another adversary pass.
						</Text>
					</Show>
				</Card>
			</div>
		</Show>
	);
}

// The card-face badge. A live attempt decides the label; with none, a
// non-empty record is all the card has left to say.
export function gateBadgeLabel(
	rounds: GateRecordRound[],
	attempt: GateAttempt | undefined,
): string | undefined {
	if (attempt === undefined) {
		return rounds.length > 0 ? "gate spent" : undefined;
	}
	if (attempt.phase === "queued" || attempt.phase === "adversary") {
		return "gating";
	}
	if (attempt.phase === "exhausted") return "gate blocked";
	return "flags";
}
