import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { button, buttonLabel } from "@fcalell/ui-core/variants";

// The control that returns a transcript to its end. It floats over the pane's
// bottom edge, which is a nonzero inset the geometry gate keeps out of
// `components/`, so it lives here with the rest of the consumer geometry.
export function ScrollToBottom(props: { onClick: () => void }) {
	return (
		<div class="pointer-events-none relative">
			<div class="-top-12 pointer-events-auto absolute right-4">
				<button
					type="button"
					onClick={() => props.onClick()}
					class={cn(
						button({ emphasis: "secondary", size: "sm" }),
						buttonLabel({ emphasis: "secondary", size: "sm" }),
						"cursor-pointer rounded-full shadow-lg",
					)}
				>
					<DownIcon />
					Latest
				</button>
			</div>
		</div>
	);
}

function DownIcon() {
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
			class="size-4 shrink-0"
		>
			<title>Jump to the latest message</title>
			<path d="M12 5v14" />
			<path d="m19 12-7 7-7-7" />
		</svg>
	);
}
