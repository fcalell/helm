import { EmptyState } from "@fcalell/plugin-solid-ui/components/empty-state";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { cn } from "@fcalell/plugin-solid-ui/lib/cn";
import { createResource, For, Show } from "solid-js";
import { parseBrief } from "../../board/markdown.ts";
import { RUN_NOTES_SECTION, type Story } from "../../board/schema.ts";
import { api } from "../lib/api.ts";
import { ChecklistSection } from "./card-drawer.tsx";

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

function LineNo(props: { n: number | undefined }) {
	return (
		<span class="select-none px-1.5 text-right text-muted-foreground/70">
			{props.n ?? ""}
		</span>
	);
}

function SideBySide(props: { file: DiffFile }) {
	return (
		<div class="grid grid-cols-[auto_1fr_auto_1fr] font-mono text-xs">
			<For each={props.file.hunks}>
				{(hunk) => (
					<>
						<div class="col-span-full bg-muted/40 px-2 py-0.5 text-muted-foreground">
							{hunk.header}
						</div>
						<For each={hunkRows(hunk.lines)}>
							{(row) =>
								row.kind === "context" ? (
									<>
										<LineNo n={row.line.oldLine} />
										<div class="col-span-3 whitespace-pre-wrap px-1.5">
											{row.line.text}
										</div>
									</>
								) : (
									<>
										<LineNo n={row.old?.oldLine} />
										<div
											class={cn(
												"whitespace-pre-wrap px-1.5",
												row.old !== undefined &&
													"bg-destructive/10 text-destructive",
											)}
										>
											{row.old?.text}
										</div>
										<LineNo n={row.new?.newLine} />
										<div
											class={cn(
												"whitespace-pre-wrap px-1.5",
												row.new !== undefined && "bg-success/10 text-success",
											)}
										>
											{row.new?.text}
										</div>
									</>
								)
							}
						</For>
					</>
				)}
			</For>
		</div>
	);
}

function FileSection(props: { file: DiffFile }) {
	const label = () =>
		props.file.status === "renamed" && props.file.oldPath !== undefined
			? `${props.file.oldPath} → ${props.file.path}`
			: props.file.path;
	return (
		<details class="rounded-md border" open>
			<summary class="cursor-pointer px-2 py-1.5 font-mono text-xs">
				{label()} · {props.file.status} · +{props.file.additions} −
				{props.file.deletions}
			</summary>
			<Show
				when={!props.file.binary}
				fallback={
					<p class="border-t px-2 py-1.5 text-xs text-muted-foreground">
						Binary or unparsed file
					</p>
				}
			>
				<div class="overflow-x-auto border-t">
					<SideBySide file={props.file} />
				</div>
			</Show>
		</details>
	);
}

function checkVerdict(check: NonNullable<ReviewData["check"]>): string {
	if (check.exitCode === null) return "Check timed out";
	if (check.exitCode === 0) return "Check passed";
	return `Check failed (exit ${check.exitCode})`;
}

function Verification(props: { story: Story; check: ReviewData["check"] }) {
	// Run notes live on the card body (appended through update_card), never
	// on the spawn snapshot, so they come from the live story.
	const notes = () =>
		(props.story.brief.sections[RUN_NOTES_SECTION] ?? "")
			.split("\n")
			.filter((line) => line.startsWith("- "))
			.map((line) => line.slice(2));
	return (
		<div class="flex flex-col gap-2">
			<Show
				when={notes().length > 0}
				fallback={<p class="text-muted-foreground">No run notes</p>}
			>
				<ul class="flex list-disc flex-col gap-1 pl-5">
					<For each={notes()}>{(note) => <li>{note}</li>}</For>
				</ul>
			</Show>
			<Show
				when={props.check}
				fallback={
					<p class="text-muted-foreground">No check command configured</p>
				}
			>
				{(check) => (
					<details class="rounded-md border">
						<summary
							class={cn(
								"cursor-pointer px-2 py-1.5 text-xs",
								check().exitCode === 0 ? "text-success" : "text-destructive",
							)}
						>
							{checkVerdict(check())} · {check().command}
						</summary>
						<pre class="max-h-64 overflow-auto whitespace-pre-wrap border-t p-2 font-mono text-xs">
							{check().output.trim() === "" ? "(no output)" : check().output}
						</pre>
					</details>
				)}
			</Show>
		</div>
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
					fallback={<Loader text="loading the diff" class="text-xs" />}
				>
					<EmptyState
						title="Diff"
						description={String(review.error?.message ?? review.error)}
					/>
				</Show>
			}
		>
			{(data) => (
				<div class="flex flex-col gap-4 text-sm">
					<div>
						<h3 class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
							Acceptance criteria
						</h3>
						<ChecklistSection
							items={parseBrief(data().briefBody).criteria}
							warn={false}
						/>
					</div>
					<div>
						<h3 class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
							Verification
						</h3>
						<div class="mt-2">
							<Verification story={props.story} check={data().check} />
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<h3 class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
							Changes
						</h3>
						<Show
							when={data().files.length > 0}
							fallback={
								<p class="text-muted-foreground">No changes against main</p>
							}
						>
							<For each={data().files}>
								{(file) => <FileSection file={file} />}
							</For>
						</Show>
					</div>
				</div>
			)}
		</Show>
	);
}
