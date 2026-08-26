import type { JSX } from "solid-js";

// The section label above a widget, a brief section, or a round record. The
// canon has no eyebrow type role (stack holds the tracking overlay for its
// look pass), so the overlay on top of the `micro` role lives here.
export function Eyebrow(props: { children: JSX.Element }) {
	return (
		<span class="font-bold text-ink-3 text-micro uppercase tracking-widest">
			{props.children}
		</span>
	);
}
