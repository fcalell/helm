import type { JSX } from "solid-js";

// The reader's own turn in a transcript: an indented, filled block that sets
// it apart from the assistant's flush prose. Not a Card (no elevation, no
// section rhythm) and not a Badge (it holds a whole message). It takes a ref
// because the transcript anchors a newly sent message to the top of the pane.
export function Bubble(props: {
	ref?: (element: HTMLDivElement) => void;
	children: JSX.Element;
}) {
	return (
		<div
			ref={props.ref}
			class="ml-8 self-end whitespace-pre-wrap rounded-xl bg-interactive-soft px-3 py-2 text-caption"
		>
			{props.children}
		</div>
	);
}
