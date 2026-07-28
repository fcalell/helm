import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
	activeQuestions,
	answerQuestion,
	type LoggedQuestion,
} from "../lib/session-store.ts";
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
				<div class="flex flex-col gap-2 rounded-lg border border-primary/40 bg-muted/40 p-3">
					<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
						Question
						<Show when={queued() > 0}>{` · ${queued()} more waiting`}</Show>
					</span>
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
				</div>
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
		<div class="flex flex-col gap-2">
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
