import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import type { JSX } from "solid-js";

// A native `<details>` block with the canon's surface. The canon has no
// disclosure component; a diff file and a held tool call both need one that
// keeps the browser's own open/closed state rather than a signal per row.
export function Disclosure(props: {
	summary: JSX.Element;
	tone?: "ink-1" | "ink-3" | "ok" | "danger";
	open?: boolean;
	bordered?: boolean;
	children: JSX.Element;
}) {
	return (
		<details
			class={cn(props.bordered !== false && "rounded-md border border-edge")}
			open={props.open}
		>
			<summary
				class={cn(
					"cursor-pointer px-2 py-1.5 font-mono text-micro",
					props.tone === "ok" && "text-ok",
					props.tone === "danger" && "text-danger",
					props.tone === "ink-3" && "text-ink-3",
				)}
			>
				{props.summary}
			</summary>
			{props.children}
		</details>
	);
}
