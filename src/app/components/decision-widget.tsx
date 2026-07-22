import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { createSignal, For, Show } from "solid-js";
import type { PendingDecision } from "../../server/mcp/schemas.ts";
import { resolveDecision } from "../lib/session-store.ts";
import { AnswerChip } from "./answer-chip.tsx";

// One actionable decision. Answering resolves it immediately (decisions fold
// into the thread file one at a time and may unblock the session), so they are
// never batched with the question group's answers.
export function DecisionWidget(props: { decision: PendingDecision }) {
	const [freeText, setFreeText] = createSignal("");
	const [inFlight, setInFlight] = createSignal(false);

	async function answer(text: string): Promise<void> {
		if (text.trim() === "" || inFlight()) return;
		setInFlight(true);
		try {
			await resolveDecision(props.decision, text.trim());
		} catch {
			// toasted by the store; keep the widget for a retry
		} finally {
			setInFlight(false);
		}
	}

	return (
		<div class="flex flex-col gap-2 rounded-lg border border-primary/40 bg-muted/40 p-3">
			<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
				Decision
			</span>
			<p class="text-sm font-semibold">{props.decision.decision}</p>
			<Show when={props.decision.context}>
				{(context) => (
					<p class="whitespace-pre-wrap text-sm text-muted-foreground">
						{context()}
					</p>
				)}
			</Show>
			<Show when={props.decision.recommendation}>
				{(recommendation) => (
					<p class="text-xs text-muted-foreground">
						Recommended: {recommendation()}
					</p>
				)}
			</Show>
			<div class="flex flex-wrap gap-2">
				<Show when={props.decision.recommendation}>
					{(recommendation) => (
						<AnswerChip
							label="Use recommendation"
							selected
							disabled={inFlight()}
							onClick={() => void answer(recommendation())}
						/>
					)}
				</Show>
				<For each={props.decision.options ?? []}>
					{(option) => (
						<AnswerChip
							label={option}
							selected={false}
							disabled={inFlight()}
							onClick={() => void answer(option)}
						/>
					)}
				</For>
			</div>
			<form
				class="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void answer(freeText());
				}}
			>
				<Input
					size="sm"
					value={freeText()}
					onInput={(event) => setFreeText(event.currentTarget.value)}
					placeholder="Or answer in your own words…"
					aria-label={`Answer to: ${props.decision.decision}`}
				/>
				<Button
					type="submit"
					size="sm"
					variant="outline"
					disabled={inFlight() || freeText().trim() === ""}
				>
					Send
				</Button>
			</form>
		</div>
	);
}
