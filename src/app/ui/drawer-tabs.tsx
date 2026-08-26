import * as TabsPrimitive from "@kobalte/core/tabs";
import type { JSX } from "solid-js";
import { For } from "solid-js";

export interface DrawerTab {
	value: string;
	label: string;
	content: JSX.Element;
}

// The fill-and-scroll tab panel. The canon's `Tabs` carries no layout props by
// design and its panel is content-height, so a tab holding a chat or a diff
// has no box to scroll in. Helm's drawers need exactly that, so the panel is
// composed here over the same Kobalte primitive: the list is intrinsic and the
// selected panel flexes. The panel scrolls nothing itself, so each tab's
// content stays the one scroll owner for its own box.
export function DrawerTabs(props: {
	tabs: DrawerTab[];
	value: string;
	onValueChange: (value: string) => void;
}) {
	return (
		<TabsPrimitive.Root
			value={props.value}
			onChange={props.onValueChange}
			class="flex min-h-0 flex-1 flex-col"
		>
			<TabsPrimitive.List class="relative flex shrink-0 items-center gap-row border-edge border-b">
				<For each={props.tabs}>
					{(tab) => (
						<TabsPrimitive.Trigger
							value={tab.value}
							class="cursor-pointer px-3 py-1.5 font-medium text-callout text-ink-3 transition-colors duration-(--duration-base) ease-ui hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-interactive focus-visible:outline-offset-2 data-selected:text-ink-1"
						>
							{tab.label}
						</TabsPrimitive.Trigger>
					)}
				</For>
				<TabsPrimitive.Indicator class="absolute -bottom-px start-0 h-0.5 bg-accent transition-all duration-250" />
			</TabsPrimitive.List>
			<For each={props.tabs}>
				{(tab) => (
					<TabsPrimitive.Content
						value={tab.value}
						class="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:outline-interactive"
					>
						{tab.content}
					</TabsPrimitive.Content>
				)}
			</For>
		</TabsPrimitive.Root>
	);
}
