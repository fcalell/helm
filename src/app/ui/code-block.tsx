import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import type { JSX } from "solid-js";

// A capped, scrolling monospace block. `ScrollArea` is the fill pane of a flex
// parent and takes no height cap, and the canon sends a capped pane carrying
// product look to the consumer, so tool output and diff bodies scroll here.
const CAPS = {
	sm: "max-h-48 overflow-y-auto",
	md: "max-h-64 overflow-auto",
	none: "overflow-x-auto",
} as const;

export function CodeBlock(props: {
	cap?: keyof typeof CAPS;
	tone?: "ink-3" | "danger";
	children: JSX.Element;
}) {
	return (
		<pre
			class={cn(
				"whitespace-pre-wrap font-mono text-micro",
				CAPS[props.cap ?? "none"],
				props.tone === "danger" ? "text-danger" : "text-ink-3",
			)}
		>
			{props.children}
		</pre>
	);
}
