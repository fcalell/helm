import type { JSX } from "solid-js";

// A settled item that stays visible with its answer struck through. The canon
// has no strikethrough: it is neither a type role nor a tone, and `Text` is
// closed to classes, so the one treatment lives here.
export function Struck(props: { children: JSX.Element }) {
	return (
		<span class="text-caption text-ink-3 line-through">{props.children}</span>
	);
}
