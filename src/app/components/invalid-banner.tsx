import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { createSignal, For, Show } from "solid-js";

interface InvalidBannerProps {
	invalid: Record<string, string>;
}

export function InvalidBanner(props: InvalidBannerProps) {
	const [expanded, setExpanded] = createSignal(false);
	const entries = () => Object.entries(props.invalid);

	return (
		<Show when={entries().length > 0}>
			<div class="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning">
				<div class="flex items-center justify-between">
					<span>{`${entries().length} invalid board files`}</span>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded() ? "Hide" : "Show"}
					</Button>
				</div>
				<Show when={expanded()}>
					<ul class="mt-2 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
						<For each={entries()}>
							{([path, message]) => (
								<li>
									{path}: {message}
								</li>
							)}
						</For>
					</ul>
				</Show>
			</div>
		</Show>
	);
}
