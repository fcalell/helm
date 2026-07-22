import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
	activeQuestions,
	answerQuestions,
	type LoggedQuestion,
} from "../lib/session-store.ts";
import { AnswerChip } from "./answer-chip.tsx";

// The session's pending questions gathered into one block above the composer.
// Chips only select an answer into the local map; nothing sends until every
// question is answered and "Send answers" fires one batched round-trip.
export function QuestionGroup(props: { sessionId: string }) {
	const questions = () => activeQuestions(props.sessionId);
	const [answers, setAnswers] = createStore<Record<string, string>>({});
	const [inFlight, setInFlight] = createSignal(false);

	const answerFor = (id: string): string => answers[id] ?? "";
	const setAnswer = (id: string, value: string): void => setAnswers(id, value);

	const complete = () =>
		questions().every((question) => answerFor(question.id).trim() !== "");

	async function send(): Promise<void> {
		if (!complete() || inFlight()) return;
		const batch = questions().map((question) => ({
			question,
			answer: answerFor(question.id).trim(),
		}));
		setInFlight(true);
		try {
			await answerQuestions(batch);
			for (const { question } of batch) setAnswers(question.id, "");
		} catch {
			// toasted by the store; keep the drafts for a retry
		} finally {
			setInFlight(false);
		}
	}

	return (
		<Show when={questions().length > 0}>
			<div class="flex flex-col gap-4 rounded-lg border border-primary/40 bg-muted/40 p-3">
				<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
					{questions().length > 1 ? "Questions" : "Question"}
				</span>
				<For each={questions()}>
					{(question) => (
						<QuestionRow
							question={question}
							value={answerFor(question.id)}
							disabled={inFlight()}
							onAnswer={(value) => setAnswer(question.id, value)}
						/>
					)}
				</For>
				<Button
					size="sm"
					disabled={!complete() || inFlight()}
					onClick={() => void send()}
				>
					Send answers
				</Button>
			</div>
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
		<div class="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
			<p class="text-sm">{props.question.question}</p>
			<div class="flex flex-wrap gap-2">
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
			</div>
			<Input
				size="sm"
				value={props.value}
				onInput={(event) => props.onAnswer(event.currentTarget.value)}
				placeholder="Or answer in your own words…"
				aria-label={`Answer to: ${props.question.question}`}
				disabled={props.disabled}
			/>
		</div>
	);
}
