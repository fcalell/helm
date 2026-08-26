import type { JSX } from "solid-js";

// The board's top chrome: an intrinsic-height row inside the frame, with the
// page inset and the hairline under it. The vocabulary carries neither a
// padding nor a border, and the canon's Section.Header belongs to a region
// inside a page rather than to the frame itself.
export function AppBar(props: { children: JSX.Element }) {
	return (
		<header class="flex h-14 shrink-0 items-center justify-between gap-gutter border-edge border-b px-4">
			{props.children}
		</header>
	);
}
