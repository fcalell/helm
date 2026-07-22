import { Button } from "@fcalell/plugin-solid-ui/components/button";
import type { JSX } from "solid-js";

// A quick-reply chip that never overflows its container: the label wraps and
// the button grows vertically instead of clipping. Used by the question group
// and the decision widget; a recommendation renders as a "Use recommendation"
// chip, never as a full-sentence label.
export function AnswerChip(props: {
	label: string;
	selected: boolean;
	disabled?: boolean;
	onClick: () => void;
	children?: JSX.Element;
}) {
	return (
		<Button
			size="sm"
			variant={props.selected ? "secondary" : "outline"}
			class="h-auto min-w-0 max-w-full whitespace-normal text-left"
			disabled={props.disabled}
			onClick={() => props.onClick()}
		>
			{props.children ?? props.label}
		</Button>
	);
}
