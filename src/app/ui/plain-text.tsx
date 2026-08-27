import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import type { JSX } from "solid-js";

// Author-entered text, rendered with its newlines intact and never as
// markdown. `Text` is the role primitive but closes `class`, and
// `whitespace-pre-wrap` is not a type role, so the pre-wrap paragraph is
// Helm's. A brief section, a gate flag and a proposal body flow through here;
// a transcript turn goes through the canon's `Prose` instead.
const VARIANTS = {
	micro: "text-micro",
	caption: "text-caption",
	callout: "text-callout",
	body: "text-body",
} as const;

const TONES = {
	"ink-1": "text-ink-1",
	"ink-2": "text-ink-2",
	"ink-3": "text-ink-3",
	danger: "text-danger",
	warn: "text-warn",
} as const;

export function PlainText(props: {
	variant?: keyof typeof VARIANTS;
	tone?: keyof typeof TONES;
	italic?: boolean;
	children: JSX.Element;
}) {
	return (
		<p
			class={cn(
				"whitespace-pre-wrap",
				VARIANTS[props.variant ?? "caption"],
				TONES[props.tone ?? "ink-1"],
				props.italic && "italic",
			)}
		>
			{props.children}
		</p>
	);
}
