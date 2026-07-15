import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Tooltip } from "@fcalell/plugin-solid-ui/components/tooltip";
import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { createResource, Show } from "solid-js";
import { api } from "../lib/api.ts";

interface BoardHeaderProps {
	connected: boolean;
}

export function BoardHeader(props: BoardHeaderProps) {
	const [repo] = createResource(() => api.repo.get());

	return (
		<header class="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
			<div class="flex items-center gap-3">
				<span class="text-lg font-bold tracking-tight text-foreground">
					Helm
				</span>
				<Show when={repo()}>
					{(info) => (
						<div class="flex items-center gap-2">
							<Badge variant="secondary">{info().name}</Badge>
							<span class="text-sm text-muted-foreground">{info().branch}</span>
						</div>
					)}
				</Show>
			</div>
			<div class="flex items-center gap-4">
				<span class="text-xs text-muted-foreground">queue 0/1</span>
				<Tooltip>
					<Tooltip.Trigger as="span" class="text-xs text-muted-foreground">
						rate limit
					</Tooltip.Trigger>
					<Tooltip.Content>Arrives with runs</Tooltip.Content>
				</Tooltip>
				<Tooltip>
					<Tooltip.Trigger
						as="div"
						class={cn(
							"size-2.5 rounded-full",
							props.connected ? "bg-success" : "bg-destructive",
						)}
					/>
					<Tooltip.Content>
						{props.connected ? "Live" : "Reconnecting"}
					</Tooltip.Content>
				</Tooltip>
			</div>
		</header>
	);
}
