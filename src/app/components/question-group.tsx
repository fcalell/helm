import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Card } from "@fcalell/plugin-solid-ui/components/card";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { Row } from "@fcalell/plugin-solid-ui/components/row";
import { Stack } from "@fcalell/plugin-solid-ui/components/stack";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
	activeQuestions,
	answerQuestion,
	type LoggedQuestion,
} from "../lib/session-store.ts";
import { Eyebrow } from "../ui/eyebrow.tsx";
import { AnswerChip } from "./answer-chip.tsx";

// One question at a time: only the oldest pending question is actionable, and
// sending its answer resumes the session immediately. Any later questions (a
// pile predating the one-pending-question tool guard) wait behind a count and
// surface one by one as the pile drains. Drafts are keyed by question id so an
// unrelated snapshot broadcast never clears what the user typed.
export function QuestionGroup(props: { sessionId: string }) {
	const questions = () => activeQuestions(props.sessionId);
	const current = () => questions()[0];
	const queued = () => questions().length - 1;
	const [drafts, setDrafts] = createStore<Record<string, string>>({});
	const [inFlight, setInFlight] = createSignal(false);

	const draft = () => {
		const question = current();
		return question === undefined ? "" : (drafts[question.id] ?? "");
	};

	async function send(): Promise<void> {
		const question = current();
		const answer = draft().trim();
		if (question === undefined || answer === "" || inFlight()) return;
		setInFlight(true);
		try {
			await answerQuestion(question, answer);
		} finally {
			setInFlight(false);
		}
	}

	return (
		<Show when={current()}>
			{(question) => (
				<Card>
					<Eyebrow>
						Question
						<Show when={queued() > 0}>{` · ${queued()} more waiting`}</Show>
					</Eyebrow>
					<QuestionRow
						question={question()}
						value={draft()}
						disabled={inFlight()}
						onAnswer={(value) => setDrafts(question().id, value)}
					/>
					<Button
						size="sm"
						disabled={draft().trim() === "" || inFlight()}
						onClick={() => void send()}
					>
						Send answer
					</Button>
				</Card>
			)}
		</Show>
	);
}

function QuestionRow(props: {
	question: LoggedQuestion;
	value: string;
	disabled: boolean;
	onAnswer: (value: string) => void;
}) {
	// The recommendation doubles as the first chip unless an option repeats it.
	const options = () => {
		const opts = props.question.options ?? [];
		return opts.includes(props.question.recommendation)
			? opts
			: [props.question.recommendation, ...opts];
	};

	return (
		<Stack>
			<Text variant="caption">{props.question.question}</Text>
			<Row wrap>
				<For each={options()}>
					{(option) => (
						<AnswerChip
							label={option}
							selected={props.value === option}
							disabled={props.disabled}
							onClick={() => props.onAnswer(option)}
						/>
					)}
				</For>
			</Row>
			<Input
				value={props.value}
				onInput={(event) => props.onAnswer(event.currentTarget.value)}
				placeholder="Or answer in your own words…"
				aria-label={`Answer to: ${props.question.question}`}
				disabled={props.disabled}
			/>
		</Stack>
	);
}
