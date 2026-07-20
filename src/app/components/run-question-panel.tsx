import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { createSignal, For } from "solid-js";
import type { RunQuestion } from "../../board/schema.ts";
import { answerRunQuestion } from "../lib/session-store.ts";

// The needs-input quick-reply form, fed from the open run entry's question
// in frontmatter (so it survives restarts); answering resumes the run.
export function RunQuestionPanel(props: {
	storyId: string;
	question: RunQuestion;
}) {
	const [freeText, setFreeText] = createSignal("");
	const [inFlight, setInFlight] = createSignal(false);

	// The recommendation doubles as the first chip unless it repeats an option.
	const chips = () => {
		const options = props.question.options ?? [];
		return options.includes(props.question.recommendation)
			? options
			: [props.question.recommendation, ...options];
	};

	async function answer(text: string): Promise<void> {
		if (text.trim() === "") return;
		setInFlight(true);
		try {
			await answerRunQuestion(props.storyId, text.trim());
		} catch {
			// Toasted in the store; the panel stays for a retry.
		} finally {
			setInFlight(false);
		}
	}

	return (
		<div class="flex flex-col gap-2 rounded-lg border border-primary/40 bg-muted/40 p-3">
			<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
				Run needs input
			</span>
			<p class="text-sm">{props.question.text}</p>
			<p class="text-xs text-muted-foreground">
				Recommended: {props.question.recommendation}
			</p>
			<div class="flex flex-wrap gap-2">
				<For each={chips()}>
					{(option) => (
						<Button
							size="sm"
							variant={
								option === props.question.recommendation
									? "secondary"
									: "outline"
							}
							disabled={inFlight()}
							onClick={() => void answer(option)}
						>
							{option}
						</Button>
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
					aria-label="Answer"
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
