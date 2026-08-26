import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { For, type JSX } from "solid-js";

// The side-by-side diff table. A four-track grid with per-line insets and
// add/remove fills is product look end to end; the vocabulary carries no grid
// and no padding, so the whole table lives here.
export function DiffGrid(props: { children: JSX.Element }) {
	return (
		<div class="grid grid-cols-[auto_1fr_auto_1fr] font-mono text-micro">
			{props.children}
		</div>
	);
}

export function DiffHunkHeader(props: { children: JSX.Element }) {
	return (
		<div class="col-span-full bg-surface-2 px-2 py-0.5 text-ink-3">
			{props.children}
		</div>
	);
}

export function DiffLineNo(props: { n: number | undefined }) {
	return (
		<span class="select-none px-1.5 text-right text-ink-3">
			{props.n ?? ""}
		</span>
	);
}

export function DiffCell(props: {
	kind?: "add" | "del";
	span?: boolean;
	children: JSX.Element;
}) {
	return (
		<div
			class={cn(
				"whitespace-pre-wrap px-1.5",
				props.span && "col-span-3",
				props.kind === "del" && "bg-danger-soft text-danger",
				props.kind === "add" && "bg-ok-soft text-ok",
			)}
		>
			{props.children}
		</div>
	);
}

// The one-file, all-added rendering a Write tool call produces, and the
// old/new pair an Edit produces. Capped so a long file never owns the pane.
export function DiffLines(props: { removed: string[]; added: string[] }) {
	return (
		<pre class="max-h-48 overflow-y-auto whitespace-pre-wrap p-1 font-mono text-micro">
			<For each={props.removed}>
				{(line) => <div class="bg-danger-soft text-danger">- {line}</div>}
			</For>
			<For each={props.added}>
				{(line) => <div class="bg-ok-soft text-ok">+ {line}</div>}
			</For>
		</pre>
	);
}
