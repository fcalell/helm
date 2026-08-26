import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Card } from "@fcalell/plugin-solid-ui/components/card";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createSignal, For, Show } from "solid-js";
import type { PendingDecision } from "../../server/mcp/schemas.ts";
import { resolveDecision } from "../lib/session-store.ts";
import { Eyebrow } from "../ui/eyebrow.tsx";
import { Prose } from "../ui/prose.tsx";
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
		<Card>
			<Eyebrow>Decision</Eyebrow>
			<Text variant="caption" strong>
				{props.decision.decision}
			</Text>
			<Show when={props.decision.context}>
				{(context) => (
					<Prose variant="caption" tone="ink-3">
						{context()}
					</Prose>
				)}
			</Show>
			<Show when={props.decision.recommendation}>
				{(recommendation) => (
					<Text variant="micro" tone="ink-3">
						Recommended: {recommendation()}
					</Text>
				)}
			</Show>
			<div class="flex flex-wrap gap-row">
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
				class="flex gap-row"
				onSubmit={(event) => {
					event.preventDefault();
					void answer(freeText());
				}}
			>
				<Input
					value={freeText()}
					onInput={(event) => setFreeText(event.currentTarget.value)}
					placeholder="Or answer in your own words…"
					aria-label={`Answer to: ${props.decision.decision}`}
				/>
				<Button
					type="submit"
					size="sm"
					emphasis="secondary"
					disabled={inFlight() || freeText().trim() === ""}
				>
					Send
				</Button>
			</form>
		</Card>
	);
}
