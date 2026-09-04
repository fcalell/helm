import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { button, buttonLabel } from "@fcalell/ui-core/variants";
import { ArrowDown } from "lucide-solid";

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
						"inline-flex cursor-pointer items-center gap-pair rounded-full shadow-lg",
					)}
				>
					<ArrowDown class="size-4 shrink-0" aria-hidden="true" />
					Latest
				</button>
			</div>
		</div>
	);
}
