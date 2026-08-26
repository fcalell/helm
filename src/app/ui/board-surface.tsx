import type { JSX } from "solid-js";

// The two board bodies. Both are the frame's one flexing region and both
// carry a page inset, which the vocabulary has no member for, so the pane and
// its padding live together here rather than splitting across a call site.

// The flat board: a full-height strip of columns that scrolls sideways.
export function BoardStrip(props: { children: JSX.Element }) {
	return (
		<div class="flex min-h-0 flex-1 gap-gutter overflow-x-auto p-4">
			{props.children}
		</div>
	);
}

// The epic view: lanes stacked down the page, each scrolling sideways itself.
export function BoardStack(props: { children: JSX.Element }) {
	return (
		<div class="flex min-h-0 flex-1 flex-col gap-room overflow-y-auto p-4">
			{props.children}
		</div>
	);
}
