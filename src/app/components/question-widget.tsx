import { Show } from "solid-js";
import { isSuperseded, type LoggedQuestion } from "../lib/session-store.ts";

// Inert record of an in-transcript question. The one actionable rendering is
// the question group above the composer, so a live question renders nothing
// here (no duplicate card); a settled question (answered or superseded)
// collapses to a single line so scroll-back never reads as a wall of question
// blocks.
export function QuestionWidget(props: { question: LoggedQuestion }) {
	const settled = () => {
		if (!props.question.pending) {
			return props.question.answeredWith === undefined
				? "Answered"
				: `Answered: ${props.question.answeredWith}`;
		}
		return isSuperseded(props.question) ? "Superseded" : undefined;
	};

	return (
		<Show when={settled()}>
			{(state) => (
				<p
					class="truncate text-xs text-muted-foreground"
					title={props.question.question}
				>
					<span class="font-semibold">{state()}</span> ·{" "}
					{props.question.question}
				</p>
			)}
		</Show>
	);
}
