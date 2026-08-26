import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { button, buttonLabel } from "@fcalell/ui-core/variants";
import type { JSX } from "solid-js";

// A square, label-less button. The canon ships no icon size and no class prop,
// and names the icon-only look a consumer primitive, so it is composed here
// from the same BUTTON cells rather than hand-written: only the padding is
// overridden, to a square that still clears the 44px tap floor.
export function IconButton(props: {
	label: string;
	onClick: () => void;
	children: JSX.Element;
}) {
	return (
		<button
			type="button"
			aria-label={props.label}
			onClick={() => props.onClick()}
			class={cn(
				button({ emphasis: "tertiary", size: "sm" }),
				buttonLabel({ emphasis: "tertiary", size: "sm" }),
				"inline-flex size-11 cursor-pointer items-center justify-center p-0 transition-colors duration-(--duration-fast) ease-ui hover:bg-surface-2 active:bg-surface-3 [&_svg]:size-4 [&_svg]:shrink-0",
			)}
		>
			{props.children}
		</button>
	);
}
