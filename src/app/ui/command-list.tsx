import type { JSX } from "solid-js";

// The slash-command palette above the composer. A menu of typed-into matches
// is not a DropdownMenu (nothing triggers it, and it never traps focus away
// from the composer), so the rows are Helm's.
export function CommandList(props: { children: JSX.Element }) {
	return (
		<div class="shrink-0 rounded-md border border-edge bg-surface p-1">
			{props.children}
		</div>
	);
}

export function CommandRow(props: {
	name: string;
	hint: string;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			class="flex w-full cursor-pointer items-baseline gap-row rounded-md px-2 py-1 text-left transition-colors duration-(--duration-fast) ease-ui hover:bg-surface-2"
			onClick={() => props.onSelect()}
		>
			<span class="font-mono text-caption text-ink-1">{props.name}</span>
			<span class="text-ink-3 text-micro">{props.hint}</span>
		</button>
	);
}
