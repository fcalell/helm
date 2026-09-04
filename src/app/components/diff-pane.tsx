import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { ScrollArea } from "@fcalell/plugin-solid-ui/components/scroll-area";
import { Section } from "@fcalell/plugin-solid-ui/components/section";
import { Stack } from "@fcalell/plugin-solid-ui/components/stack";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createResource, For, Show } from "solid-js";
import { parseBrief } from "../../board/markdown.ts";
import { RUN_NOTES_SECTION, type Story } from "../../board/schema.ts";
import { api } from "../lib/api.ts";
import { CodeBlock } from "../ui/code-block.tsx";
import {
	DiffCell,
	DiffGrid,
	DiffHunkHeader,
	DiffLineNo,
} from "../ui/diff-grid.tsx";
import { Disclosure } from "../ui/disclosure.tsx";
import { ChecklistSection } from "./brief-view.tsx";

type ReviewData = Awaited<ReturnType<typeof api.review.get>>;
type DiffFile = ReviewData["files"][number];
type DiffLine = DiffFile["hunks"][number]["lines"][number];

// One rendered grid row: a context line spans both sides, a pair row holds
// the i-th del of a change block beside its i-th add.
type Row =
	| { kind: "context"; line: DiffLine }
	| { kind: "pair"; old?: DiffLine; new?: DiffLine };

function hunkRows(lines: DiffLine[]): Row[] {
	const rows: Row[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) break;
		if (line.kind === "context") {
			rows.push({ kind: "context", line });
			i++;
			continue;
		}
		const dels: DiffLine[] = [];
		const adds: DiffLine[] = [];
		for (let next = lines[i]; next?.kind === "del"; next = lines[++i]) {
			dels.push(next);
		}
		for (let next = lines[i]; next?.kind === "add"; next = lines[++i]) {
			adds.push(next);
		}
		for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
			rows.push({ kind: "pair", old: dels[j], new: adds[j] });
		}
	}
	return rows;
}

function SideBySide(props: { file: DiffFile }) {
	return (
		<DiffGrid>
			<For each={props.file.hunks}>
				{(hunk) => (
					<>
						<DiffHunkHeader>{hunk.header}</DiffHunkHeader>
						<For each={hunkRows(hunk.lines)}>
							{(row) =>
								row.kind === "context" ? (
									<>
										<DiffLineNo n={row.line.oldLine} />
										<DiffCell span>{row.line.text}</DiffCell>
									</>
								) : (
									<>
										<DiffLineNo n={row.old?.oldLine} />
										<DiffCell kind={row.old !== undefined ? "del" : undefined}>
											{row.old?.text}
										</DiffCell>
										<DiffLineNo n={row.new?.newLine} />
										<DiffCell kind={row.new !== undefined ? "add" : undefined}>
											{row.new?.text}
										</DiffCell>
									</>
								)
							}
						</For>
					</>
				)}
			</For>
		</DiffGrid>
	);
}

function FileSection(props: { file: DiffFile }) {
	const label = () =>
		props.file.status === "renamed" && props.file.oldPath !== undefined
			? `${props.file.oldPath} → ${props.file.path}`
			: props.file.path;
	return (
		<Disclosure
			open
			summary={
				<>
					{label()} · {props.file.status} · +{props.file.additions} −
					{props.file.deletions}
				</>
			}
		>
			<Show
				when={!props.file.binary}
				fallback={
					<Text variant="micro" tone="ink-3">
						Binary or unparsed file
					</Text>
				}
			>
				<ScrollArea axis="x">
					<SideBySide file={props.file} />
				</ScrollArea>
			</Show>
		</Disclosure>
	);
}

function checkVerdict(check: NonNullable<ReviewData["check"]>): string {
	if (check.exitCode === null) return "Check timed out";
	if (check.exitCode === 0) return "Check passed";
	return `Check failed (exit ${check.exitCode})`;
}

function Verification(props: { story: Story; check: ReviewData["check"] }) {
	// Run notes live on the card body (appended through update_card), never
	// on the spawn snapshot, so they come from the live story. Only the
	// `verify:` bullets are by-hand checks; other notes are progress/decisions.
	const notes = () =>
		(props.story.brief.sections[RUN_NOTES_SECTION] ?? "")
			.split("\n")
			.filter((line) => line.startsWith("- "))
			.map((line) => line.slice(2))
			.filter((note) => /^verify:/i.test(note));
	return (
		<Stack>
			<Show
				when={notes().length > 0}
				fallback={
					<Text variant="caption" tone="ink-3">
						No run notes
					</Text>
				}
			>
				<Stack>
					<For each={notes()}>
						{(note) => <Text variant="caption">{note}</Text>}
					</For>
				</Stack>
			</Show>
			<Show
				when={props.check}
				fallback={
					<Text variant="caption" tone="ink-3">
						No check command configured
					</Text>
				}
			>
				{(check) => (
					<Disclosure
						tone={check().exitCode === 0 ? "ok" : "danger"}
						summary={
							<>
								{checkVerdict(check())} · {check().command}
							</>
						}
					>
						<CodeBlock cap="md">
							{check().output.trim() === "" ? "(no output)" : check().output}
						</CodeBlock>
					</Disclosure>
				)}
			</Show>
		</Stack>
	);
}

export function DiffPane(props: { story: Story }) {
	const [review] = createResource(
		() => props.story.id,
		(storyId) => api.review.get({ storyId }),
	);
	return (
		<Show
			when={review()}
			fallback={
				<Show
					when={review.error !== undefined}
					fallback={<Loader text="loading the diff" />}
				>
					<EmptyState
						title="Diff"
						description={String(review.error?.message ?? review.error)}
					/>
				</Show>
			}
		>
			{(data) => (
				<>
					<Section>
						<Section.Header>
							<Section.Title>Acceptance criteria</Section.Title>
						</Section.Header>
						<Section.Content>
							<ChecklistSection
								items={parseBrief(data().briefBody).criteria}
								warn={false}
							/>
						</Section.Content>
					</Section>
					<Section>
						<Section.Header>
							<Section.Title>Verification</Section.Title>
						</Section.Header>
						<Section.Content>
							<Verification story={props.story} check={data().check} />
						</Section.Content>
					</Section>
					<Section>
						<Section.Header>
							<Section.Title>Changes</Section.Title>
						</Section.Header>
						<Section.Content>
							<Show
								when={data().files.length > 0}
								fallback={
									<Text variant="caption" tone="ink-3">
										No changes against main
									</Text>
								}
							>
								<Stack>
									<For each={data().files}>
										{(file) => <FileSection file={file} />}
									</For>
								</Stack>
							</Show>
						</Section.Content>
					</Section>
				</>
			)}
		</Show>
	);
}
