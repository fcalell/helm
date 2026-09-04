import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Card } from "@fcalell/plugin-solid-ui/components/card";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { Row } from "@fcalell/plugin-solid-ui/components/row";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createSignal, For } from "solid-js";
import type { RunQuestion } from "../../board/schema.ts";
import { answerRunQuestion } from "../lib/session-store.ts";
import { Eyebrow } from "../ui/eyebrow.tsx";
import { AnswerChip } from "./answer-chip.tsx";

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
		<Card>
			<Eyebrow>Run needs input</Eyebrow>
			<Text variant="caption">{props.question.text}</Text>
			<Text variant="micro" tone="ink-3">
				Recommended: {props.question.recommendation}
			</Text>
			<Row wrap>
				<For each={chips()}>
					{(option) => (
						<AnswerChip
							label={option}
							selected={option === props.question.recommendation}
							disabled={inFlight()}
							onClick={() => void answer(option)}
						/>
					)}
				</For>
			</Row>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void answer(freeText());
				}}
			>
				<Row>
					<Input
						value={freeText()}
						onInput={(event) => setFreeText(event.currentTarget.value)}
						placeholder="Or answer in your own words…"
						aria-label="Answer"
					/>
					<Button
						type="submit"
						size="sm"
						emphasis="secondary"
						disabled={inFlight() || freeText().trim() === ""}
					>
						Send
					</Button>
				</Row>
			</form>
		</Card>
	);
}
