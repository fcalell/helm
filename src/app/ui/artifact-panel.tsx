import type { JSX } from "solid-js";
import { Eyebrow } from "./eyebrow.tsx";

// The artifact-under-construction box above a chat transcript. A capped pane
// carrying product look is consumer territory by the canon's own rule: it
// takes at most a share of the pane so the transcript always keeps the rest,
// which no shipped scroll owner expresses.
export function ArtifactPanel(props: { title: string; children: JSX.Element }) {
	return (
		<div class="flex max-h-[45%] shrink-0 flex-col gap-pair overflow-y-auto rounded-xl border border-edge bg-surface p-card">
			<Eyebrow>{props.title}</Eyebrow>
			<div class="text-caption text-ink-3">{props.children}</div>
		</div>
	);
}
