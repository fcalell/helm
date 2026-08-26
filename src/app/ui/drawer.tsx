import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import {
	sheetOverlayClass,
	sheetPortalVariants,
	sheetVariants,
} from "@fcalell/plugin-solid-ui/lib/sheet";
import * as DialogPrimitive from "@kobalte/core/dialog";
import type { JSX } from "solid-js";

// Helm's drawer. `Sheet.Content` is its own scroll owner (`max-h-screen
// overflow-y-auto`, block not flex), so a fill pane cannot compose inside it
// and a chat, an activity timeline, and a diff would all scroll the sheet as
// one page. The canon sends a non-scrolling drawer layout to the consumer, so
// this composes Kobalte's dialog with the plugin's own sheet look and lays the
// panel out as a capped flex column: the header is intrinsic, and exactly one
// child region flexes and owns its scrolling.
export function Drawer(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	expanded: boolean;
	children: JSX.Element;
}) {
	return (
		<DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
			<DialogPrimitive.Portal>
				<div class={sheetPortalVariants({ position: "right" })}>
					<DialogPrimitive.Overlay class={sheetOverlayClass} />
					<DialogPrimitive.Content
						class={cn(
							sheetVariants({
								position: "right",
								size: props.expanded ? "full" : "xl",
							}),
							"flex max-h-dvh flex-col gap-stack overflow-hidden",
						)}
					>
						{props.children}
						<DialogPrimitive.CloseButton class="absolute top-4 right-4 text-ink-3 transition-colors duration-(--duration-base) ease-ui hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-interactive focus-visible:outline-offset-2">
							<CloseIcon />
							<span class="sr-only">Close</span>
						</DialogPrimitive.CloseButton>
					</DialogPrimitive.Content>
				</div>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

// The drawer's intrinsic-height title row. Sized so the close button never
// overlaps the trailing controls.
export function DrawerHeader(props: { children: JSX.Element }) {
	return (
		<div class="flex shrink-0 flex-wrap items-center gap-row pr-8">
			{props.children}
		</div>
	);
}

export function DrawerTitle(props: { children: JSX.Element }) {
	return (
		<DialogPrimitive.Title class="font-semibold text-h3 text-ink-1">
			{props.children}
		</DialogPrimitive.Title>
	);
}

// Helm pulls in no icon library, so the glyph is inline SVG, as the drawer
// enlarge affordance already is.
function CloseIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="size-4"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}
