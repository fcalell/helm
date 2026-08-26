import type { JSX } from "solid-js";

// A summary that must stay one line however long its content is: the settled
// questions in chat scroll-back collapse to these so history never reads as a
// wall of blocks. `truncate` is not a type role, so `Text` cannot carry it.
export function OneLine(props: { title?: string; children: JSX.Element }) {
	return (
		<p class="truncate text-ink-3 text-micro" title={props.title}>
			{props.children}
		</p>
	);
}
