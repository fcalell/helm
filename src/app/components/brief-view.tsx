import { Checkbox } from "@fcalell/plugin-solid-ui/components/checkbox";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { For, Match, Show, Switch } from "solid-js";
import {
	BRIEF_SECTIONS,
	type ChecklistItem,
	type Story,
} from "../../board/schema.ts";
import { weakCriterion } from "../lib/criteria.ts";
import { Eyebrow } from "../ui/eyebrow.tsx";
import { PlainText } from "../ui/plain-text.tsx";

// The brief renderers, in their own module because both the card drawer and
// the diff pane it composes render them: importing one from the other made a
// module cycle out of a composition root reaching back into its own child.

export function ChecklistSection(props: {
	items: ChecklistItem[];
	// Weak-phrasing warnings apply to the criteria checklist alone.
	warn: boolean;
}) {
	return (
		<Show
			when={props.items.length > 0}
			fallback={
				<Text variant="caption" tone="ink-3">
					None yet
				</Text>
			}
		>
			<ul class="flex flex-col gap-row">
				<For each={props.items}>
					{(item) => {
						const weak = () =>
							props.warn ? weakCriterion(item.text) : undefined;
						return (
							<li class="flex items-start gap-row">
								<Checkbox checked={item.checked} disabled label={item.text} />
								<Show when={weak()}>
									{(phrase) => (
										<Text
											as="span"
											variant="caption"
											tone="warn"
											title={`Not measurable: "${phrase()}" — name the observable behavior instead`}
										>
											⚠
										</Text>
									)}
								</Show>
							</li>
						);
					}}
				</For>
			</ul>
		</Show>
	);
}

export function BriefView(props: { story: Story }) {
	return (
		<div class="flex flex-col gap-section">
			<For each={BRIEF_SECTIONS}>
				{(section) => (
					<div class="flex flex-col gap-row">
						<Eyebrow>{section}</Eyebrow>
						<Switch
							fallback={
								<PlainText variant="caption">
									{props.story.brief.sections[section]?.trim() || "Not set"}
								</PlainText>
							}
						>
							<Match when={section === "Acceptance criteria"}>
								<ChecklistSection items={props.story.brief.criteria} warn />
							</Match>
							<Match when={section === "Open questions"}>
								<ChecklistSection
									items={props.story.brief.openQuestions}
									warn={false}
								/>
							</Match>
						</Switch>
					</div>
				)}
			</For>
		</div>
	);
}
