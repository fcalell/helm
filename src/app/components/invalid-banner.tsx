import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createSignal, For, Show } from "solid-js";
import { Banner } from "../ui/banner.tsx";
import { CodeBlock } from "../ui/code-block.tsx";

interface InvalidBannerProps {
	invalid: Record<string, string>;
}

export function InvalidBanner(props: InvalidBannerProps) {
	const [expanded, setExpanded] = createSignal(false);
	const entries = () => Object.entries(props.invalid);

	return (
		<Show when={entries().length > 0}>
			<Banner>
				<div class="flex items-center justify-between gap-row">
					<Text variant="caption" tone="warn">
						{`${entries().length} invalid board files`}
					</Text>
					<Button
						emphasis="tertiary"
						size="sm"
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded() ? "Hide" : "Show"}
					</Button>
				</div>
				<Show when={expanded()}>
					<CodeBlock cap="sm">
						<For each={entries()}>
							{([path, message]) => (
								<div>
									{path}: {message}
								</div>
							)}
						</For>
					</CodeBlock>
				</Show>
			</Banner>
		</Show>
	);
}
