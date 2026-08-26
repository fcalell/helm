import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { button, buttonLabel } from "@fcalell/ui-core/variants";
import type { JSX } from "solid-js";

// A quick-reply chip whose label wraps instead of clipping. Button's label is
// `whitespace-nowrap` on purpose, so an answer of arbitrary length is not a
// Button; the chip keeps the BUTTON cells and overrides the wrap alone.
export function Chip(props: {
	label: string;
	selected: boolean;
	disabled?: boolean;
	onClick: () => void;
	children?: JSX.Element;
}) {
	return (
		<button
			type="button"
			disabled={props.disabled}
			onClick={() => props.onClick()}
			class={cn(
				button({ emphasis: "secondary", size: "sm" }),
				buttonLabel({ emphasis: "secondary", size: "sm" }),
				"inline-flex min-w-0 max-w-full cursor-pointer items-center whitespace-normal text-left transition-colors duration-(--duration-fast) ease-ui hover:bg-surface-2 active:bg-surface-3 disabled:pointer-events-none disabled:text-ink-4",
				props.selected && "border-accent bg-surface-2",
			)}
		>
			{props.children ?? props.label}
		</button>
	);
}
