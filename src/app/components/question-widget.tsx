import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Show } from "solid-js";
import { isSuperseded, type LoggedQuestion } from "../lib/session-store.ts";

// Inert record of an in-transcript question. The one actionable rendering is
// the question group above the composer; a widget here only shows the question
// text and its state.
export function QuestionWidget(props: { question: LoggedQuestion }) {
	const badge = () => {
		if (!props.question.pending) {
			return {
				variant: "success" as const,
				text:
					props.question.answeredWith === undefined
						? "Answered"
						: `Answered: ${props.question.answeredWith}`,
			};
		}
		if (isSuperseded(props.question)) {
			return { variant: "outline" as const, text: "Superseded" };
		}
		return { variant: "secondary" as const, text: "Awaiting answer" };
	};

	return (
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
			<Badge variant={badge().variant} class="self-start">
				{badge().text}
			</Badge>
		</div>
	);
}
