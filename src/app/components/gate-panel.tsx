import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import type {
	GateAttempt,
	GateFlag,
	GatePhase,
	GateRound,
} from "../../shared/gate.ts";
import { gateFor, resolveGateFlag } from "../lib/gate-store.ts";

const PHASE_LINES: Record<GatePhase, string> = {
	queued: "Adversary review queued",
	adversary: "Adversary review running",
	refine: "Refine chat is answering the adversary's flags",
	review: "Contested flags await your call",
	exhausted: "Two automatic rounds spent — the gate waits for you",
};

const FLAG_BADGES: Record<
	GateFlag["status"],
	{ label: string; variant: "success" | "warning" | "destructive" | "outline" }
> = {
	open: { label: "Open", variant: "outline" },
	fixed: { label: "Fixed", variant: "success" },
	contested: { label: "Contested", variant: "warning" },
	accepted: { label: "Open question", variant: "warning" },
	dismissed: { label: "Dismissed", variant: "destructive" },
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
		<div
			class="rounded-lg border border-warning/60 bg-muted/40 p-3"
			data-gate-flag={props.flag.title}
		>
			<div class="flex items-center gap-2">
				<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
					Risk flag
				</span>
				<Badge variant="warning">Contested</Badge>
			</div>
			<p class="mt-2 text-sm font-semibold">{props.flag.title}</p>
			<p class="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
				{props.flag.detail}
			</p>
			<p class="mt-2 whitespace-pre-wrap text-sm">
				<Show
					when={props.flag.argument}
					fallback={
						<span class="text-muted-foreground italic">
							The refine chat left this flag unanswered.
						</span>
					}
				>
					{(argument) => <>Counter-argument: {argument()}</>}
				</Show>
			</p>
			<div class="mt-2">
				<Show
					when={dismissing()}
					fallback={
						<div class="flex gap-2">
							<Button
								size="sm"
								disabled={inFlight()}
								onClick={() => void resolve({ type: "accept" })}
							>
								File as open question
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={inFlight()}
								onClick={() => setDismissing(true)}
							>
								Dismiss
							</Button>
						</div>
					}
				>
					<form
						class="flex flex-col gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							if (reason().trim() === "") return;
							void resolve({ type: "dismiss", reason: reason().trim() });
						}}
					>
						<Textarea
							size="sm"
							rows={2}
							value={reason()}
							onInput={(event) => setReason(event.currentTarget.value)}
							placeholder="Why is this risk accepted?"
							aria-label="Override reason"
						/>
						<div class="flex gap-2">
							<Button
								type="submit"
								size="sm"
								variant="destructive"
								disabled={inFlight() || reason().trim() === ""}
							>
								Dismiss flag
							</Button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => setDismissing(false)}
							>
								Cancel
							</Button>
						</div>
					</form>
				</Show>
			</div>
		</div>
	);
}

function RoundHistory(props: { rounds: GateRound[]; overrides: string[] }) {
	return (
		<div class="flex flex-col gap-2 text-sm">
			<For each={props.rounds}>
				{(round) => (
					<div>
						<p class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
							Round {round.n}
						</p>
						<ul class="mt-1 flex flex-col gap-1">
							<For each={round.flags}>
								{(flag) => (
									<li class="flex items-center gap-2">
										<Badge variant={FLAG_BADGES[flag.status].variant}>
											{FLAG_BADGES[flag.status].label}
										</Badge>
										<span>{flag.title}</span>
									</li>
								)}
							</For>
						</ul>
					</div>
				)}
			</For>
			<Show when={props.overrides.length > 0}>
				<div>
					<p class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
						Overrides
					</p>
					<ul class="mt-1 list-disc pl-4 text-muted-foreground">
						<For each={props.overrides}>
							{(override) => <li>{override}</li>}
						</For>
					</ul>
				</div>
			</Show>
		</div>
	);
}

export function GatePanel(props: { storyId: string }) {
	const attempt = () => gateFor(props.storyId);
	const contested = () =>
		(attempt()?.rounds.at(-1)?.flags ?? []).filter(
			(flag) => flag.status === "contested",
		);
	return (
		<Show when={attempt()}>
			{(active) => (
				<div
					class="flex shrink-0 flex-col gap-2 rounded-lg border p-3"
					data-gate-phase={active().phase}
				>
					<Switch
						fallback={
							<p class="text-sm text-muted-foreground">
								{PHASE_LINES[active().phase]}
							</p>
						}
					>
						<Match
							when={
								active().phase === "queued" || active().phase === "adversary"
							}
						>
							<Loader text={PHASE_LINES[active().phase]} class="text-xs" />
						</Match>
					</Switch>
					<For each={contested()}>
						{(flag) => <FlagWidget storyId={props.storyId} flag={flag} />}
					</For>
					<Show when={active().phase === "exhausted"}>
						<RoundHistory
							rounds={active().rounds}
							overrides={active().overrides}
						/>
						<p class="text-xs text-muted-foreground">
							Move the card to Ready to run another adversary pass.
						</p>
					</Show>
				</div>
			)}
		</Show>
	);
}

export function gateBadgeLabel(attempt: GateAttempt): string {
	if (attempt.phase === "queued" || attempt.phase === "adversary") {
		return "gating";
	}
	if (attempt.phase === "exhausted") return "gate blocked";
	return "flags";
}
