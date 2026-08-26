import type { JSX } from "solid-js";

// A board column: fixed width, a bordered surface, an intrinsic header, and a
// scrolling card list. The inset and the two heights are product look with no
// canon home (the vocabulary carries no padding and no fill height), so the
// whole column shell lives here and the call site passes only its cards.
export function ColumnFrame(props: {
	ref: (element: HTMLElement) => void;
	title: string;
	count: JSX.Element;
	// Lane columns are capped so several lanes stack on one page; the flat
	// board's columns take the height the grid gives them.
	height: "full" | "lane";
	children: JSX.Element;
}) {
	return (
		<div
			ref={props.ref}
			class={`flex w-72 shrink-0 flex-col rounded-xl border border-edge bg-surface ${
				props.height === "lane" ? "h-80" : "h-full"
			}`}
		>
			<div class="flex shrink-0 items-center justify-between gap-row border-edge border-b px-3 py-2">
				<span class="font-semibold text-caption text-ink-1">{props.title}</span>
				{props.count}
			</div>
			<div class="flex min-h-0 flex-1 flex-col gap-row overflow-y-auto p-2">
				{props.children}
			</div>
		</div>
	);
}
