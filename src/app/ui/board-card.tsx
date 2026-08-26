import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { card } from "@fcalell/ui-core/variants";
import type { ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

// A story card on the board. It is the shipped Card look plus three states the
// canon has no axis for: the whole card is the drag-and-open surface, a
// running story pulses, and the card being dragged fades under its overlay
// clone. Composed from the same CARD cells so only the states are Helm's.
export function BoardCard(
	props: ComponentProps<"div"> & {
		running?: boolean;
		dragging?: boolean;
		interactive?: boolean;
	},
) {
	const [local, rest] = splitProps(props, [
		"running",
		"dragging",
		"interactive",
	]);
	return (
		<div
			class={cn(
				card({}),
				"flex flex-col gap-row transition-shadow duration-(--duration-base) ease-ui",
				local.interactive !== false && "cursor-pointer",
				local.running && "helm-card-pulse",
				local.dragging && "opacity-40",
			)}
			{...rest}
		/>
	);
}
