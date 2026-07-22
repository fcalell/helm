import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Show } from "solid-js";

// The drawer enlarge affordance. The app pulls in no icon library (the stack's
// lucide-solid is not in Helm's own resolution), so the maximize/minimize
// glyphs are inline SVG. Shared because all three drawers render the same
// button; each call site keeps only its own `expanded` signal.
export function ExpandToggle(props: {
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<Button
			size="icon"
			variant="ghost"
			class="ml-auto size-8"
			aria-label={props.expanded ? "Shrink" : "Enlarge"}
			onClick={() => props.onToggle()}
		>
			<Show when={props.expanded} fallback={<MaximizeIcon />}>
				<MinimizeIcon />
			</Show>
		</Button>
	);
}

function MaximizeIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<title>Enlarge</title>
			<path d="M15 3h6v6" />
			<path d="M9 21H3v-6" />
			<path d="M21 3l-7 7" />
			<path d="M3 21l7-7" />
		</svg>
	);
}

function MinimizeIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<title>Shrink</title>
			<path d="M4 14h6v6" />
			<path d="M20 10h-6V4" />
			<path d="M14 10l7-7" />
			<path d="M3 21l7-7" />
		</svg>
	);
}
