import { ScrollArea } from "@fcalell/plugin-solid-ui/components/scroll-area";
import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import type { JSX } from "solid-js";

// The board is one grid: status headers once across the top, one band per
// epic below them, and one scroll owner for both axes. The geometry (the
// column width, the sticky header row and band titles, the page inset) is
// product look with no canon home, so the whole table shell lives here and
// the call sites pass only their cells.

const COLUMN_WIDTH = "18rem";

function Table(props: { columns: number; children: JSX.Element }) {
	return (
		<ScrollArea axis="both">
			<div
				class="grid w-max min-w-full gap-x-gutter p-gutter"
				style={{
					"grid-template-columns": `repeat(${props.columns}, ${COLUMN_WIDTH})`,
				}}
			>
				{props.children}
			</div>
		</ScrollArea>
	);
}

// A status header: pinned to the top while the bands scroll under it.
function Header(props: { title: string; count: JSX.Element }) {
	return (
		<div class="sticky top-0 z-10 flex items-center justify-between gap-row bg-canvas pb-row">
			<span class="font-semibold text-caption text-ink-1">{props.title}</span>
			{props.count}
		</div>
	);
}

// A band title spanning every column; its content is pinned to the left edge
// so the epic stays named while the columns scroll sideways.
function Band(props: { children: JSX.Element }) {
	return (
		<div class="col-span-full pt-room pb-row">
			<div class="sticky left-gutter flex w-fit items-center gap-row">
				{props.children}
			</div>
		</div>
	);
}

// One status cell inside a band: a bordered surface holding that band's
// cards for that status, content-height with a floor so an empty cell still
// reads as a drop target.
function Cell(props: {
	ref: (element: HTMLElement) => void;
	active?: boolean;
	children: JSX.Element;
}) {
	return (
		<div
			ref={props.ref}
			class={cn(
				"flex min-h-28 flex-col gap-row rounded-xl border border-edge bg-surface p-row transition-colors duration-(--duration-fast) ease-ui",
				props.active && "border-accent",
			)}
		>
			{props.children}
		</div>
	);
}

export const BoardTable = Object.assign(Table, { Header, Band, Cell });
