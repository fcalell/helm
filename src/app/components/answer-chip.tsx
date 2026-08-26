import type { JSX } from "solid-js";
import { Chip } from "../ui/chip.tsx";

// A quick-reply chip that never overflows its container: the label wraps and
// the control grows vertically instead of clipping. Used by the question group
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
		<Chip
			label={props.label}
			selected={props.selected}
			disabled={props.disabled}
			onClick={props.onClick}
		>
			{props.children}
		</Chip>
	);
}
