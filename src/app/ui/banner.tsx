import type { JSX } from "solid-js";

// A full-width warning strip pinned under the board header. Not a Card (it
// spans the frame edge to edge and carries no elevation) and not a toast (it
// stays until the condition clears), so the strip is Helm's.
export function Banner(props: { children: JSX.Element }) {
	return (
		<div class="flex shrink-0 flex-col gap-row border-warn/40 border-b bg-warn-soft px-4 py-2">
			{props.children}
		</div>
	);
}
