import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Show } from "solid-js";
import { isSuperseded, type LoggedQuestion } from "../lib/session-store.ts";

// Inert record of an in-transcript question. The one actionable rendering is
// the question group above the composer; a settled question (answered or
// superseded) collapses to a single line so scroll-back never reads as a wall
// of question blocks.
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
		<Show
			when={settled()}
			fallback={
				<div class="flex flex-col gap-2 rounded-lg border border-primary/40 bg-muted/40 p-3">
					<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
						Question
					</span>
					<p class="text-sm">{props.question.question}</p>
					<Show when={props.question.recommendation !== ""}>
						<p class="text-xs text-muted-foreground">
							Recommended: {props.question.recommendation}
						</p>
					</Show>
					<Badge variant="secondary" class="self-start">
						Awaiting answer
					</Badge>
				</div>
			}
		>
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
