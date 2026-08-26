import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Card } from "@fcalell/plugin-solid-ui/components/card";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import type {
	EpicDraft,
	Proposal,
	ProposalResolution,
	ResolveQuestionPayload,
	StoryDraft,
	UpdateBriefPayload,
} from "../../server/mcp/schemas.ts";
import {
	acceptAllProposalItems,
	type LoggedProposal,
	resolveProposalItem,
} from "../lib/session-store.ts";
import { CodeBlock } from "../ui/code-block.tsx";
import { Eyebrow } from "../ui/eyebrow.tsx";
import { Prose } from "../ui/prose.tsx";

const TOOL_LABELS: Record<Proposal["tool"], string> = {
	propose_epics: "Proposed epics",
	propose_stories: "Proposed stories",
	update_brief: "Brief update",
	resolve_question: "Question resolution",
};

type Item = LoggedProposal["items"][number];

function resolutionBadge(resolution: ProposalResolution) {
	if (resolution.type === "accept") {
		return <Badge tone="ok">Accepted</Badge>;
	}
	if (resolution.type === "edit") {
		return <Badge tone="warn">Edit requested</Badge>;
	}
	return <Badge tone="danger">Rejected</Badge>;
}

function ItemSummary(props: { proposal: LoggedProposal; item: Item }) {
	const payload = () => props.item.payload;
	return (
		<Switch>
			<Match when={props.proposal.tool === "propose_stories"}>
				{(() => {
					const draft = payload() as StoryDraft;
					return (
						<div class="flex flex-col gap-pair">
							<Text variant="caption" strong>
								{draft.title}
							</Text>
							<Text variant="caption" tone="ink-3">
								{draft.goal}
							</Text>
							<div class="flex flex-wrap items-center gap-pair">
								<Badge>{draft.slug}</Badge>
								<For each={draft.depends}>
									{(dep) => <Badge>needs {dep}</Badge>}
								</For>
							</div>
						</div>
					);
				})()}
			</Match>
			<Match when={props.proposal.tool === "propose_epics"}>
				{(() => {
					const draft = payload() as EpicDraft;
					return (
						<div class="flex flex-col gap-pair">
							<Text variant="caption" strong>
								{draft.title}
							</Text>
							<Text variant="caption" tone="ink-3">
								{draft.goal}
							</Text>
							<Show when={draft.rationale}>
								<Text variant="micro" tone="ink-3">
									{draft.rationale}
								</Text>
							</Show>
							<div class="flex flex-wrap items-center gap-pair">
								<Badge>{draft.slug}</Badge>
								<Show when={draft.stories.length > 0}>
									<Badge>{draft.stories.length} draft stories</Badge>
								</Show>
							</div>
						</div>
					);
				})()}
			</Match>
			<Match when={props.proposal.tool === "update_brief"}>
				{(() => {
					const draft = payload() as UpdateBriefPayload;
					return (
						<div class="flex flex-col gap-pair">
							<div class="flex items-center gap-pair">
								<Badge>{draft.section}</Badge>
								<Show when={draft.resolves}>
									{(flag) => <Badge tone="warn">resolves: {flag()}</Badge>}
								</Show>
							</div>
							<Prose variant="caption">{draft.content}</Prose>
						</div>
					);
				})()}
			</Match>
			<Match when={props.proposal.tool === "resolve_question"}>
				{(() => {
					const draft = payload() as ResolveQuestionPayload;
					return (
						<div class="flex flex-col gap-pair">
							<Text variant="caption" strong>
								{draft.question}
							</Text>
							<Prose variant="caption" tone="ink-3">
								{draft.answer}
							</Prose>
						</div>
					);
				})()}
			</Match>
			<Match when={true}>
				<CodeBlock>{JSON.stringify(payload(), null, 2)}</CodeBlock>
			</Match>
		</Switch>
	);
}

interface EditFormProps {
	proposal: LoggedProposal;
	item: Item;
	onSubmit: (payload: unknown, note: string | undefined) => void;
	onCancel: () => void;
}

function EditActions(props: { onCancel: () => void }) {
	return (
		<div class="flex gap-row">
			<Button type="submit" size="sm">
				Send edit
			</Button>
			<Button
				type="button"
				size="sm"
				emphasis="tertiary"
				onClick={props.onCancel}
			>
				Cancel
			</Button>
		</div>
	);
}

function StoryEditForm(props: EditFormProps) {
	const draft = props.item.payload as StoryDraft;
	const [slug, setSlug] = createSignal(draft.slug);
	const [title, setTitle] = createSignal(draft.title);
	const [goal, setGoal] = createSignal(draft.goal);
	const [depends, setDepends] = createSignal(draft.depends.join(", "));
	const [note, setNote] = createSignal("");
	return (
		<form
			class="flex flex-col gap-row"
			onSubmit={(event) => {
				event.preventDefault();
				props.onSubmit(
					{
						slug: slug().trim(),
						title: title().trim(),
						goal: goal().trim(),
						depends: depends()
							.split(",")
							.map((each) => each.trim())
							.filter((each) => each !== ""),
					},
					note().trim() === "" ? undefined : note().trim(),
				);
			}}
		>
			<Input
				value={slug()}
				onInput={(event) => setSlug(event.currentTarget.value)}
				placeholder="slug"
				aria-label="Slug"
			/>
			<Input
				value={title()}
				onInput={(event) => setTitle(event.currentTarget.value)}
				placeholder="Title"
				aria-label="Title"
			/>
			<Textarea
				rows={2}
				value={goal()}
				onInput={(event) => setGoal(event.currentTarget.value)}
				placeholder="Goal"
				aria-label="Goal"
			/>
			<Input
				value={depends()}
				onInput={(event) => setDepends(event.currentTarget.value)}
				placeholder="Depends on (slugs, comma-separated)"
				aria-label="Depends on"
			/>
			<Input
				value={note()}
				onInput={(event) => setNote(event.currentTarget.value)}
				placeholder="Note for the assistant (optional)"
				aria-label="Note"
			/>
			<EditActions onCancel={props.onCancel} />
		</form>
	);
}

function BriefEditForm(props: EditFormProps) {
	const draft = props.item.payload as UpdateBriefPayload;
	const [content, setContent] = createSignal(draft.content);
	const [note, setNote] = createSignal("");
	return (
		<form
			class="flex flex-col gap-row"
			onSubmit={(event) => {
				event.preventDefault();
				props.onSubmit(
					{
						section: draft.section,
						content: content().trim(),
						resolves: draft.resolves,
					},
					note().trim() === "" ? undefined : note().trim(),
				);
			}}
		>
			<div class="flex self-start">
				<Badge>{draft.section}</Badge>
			</div>
			<Textarea
				rows={6}
				value={content()}
				onInput={(event) => setContent(event.currentTarget.value)}
				aria-label="Section content"
			/>
			<Input
				value={note()}
				onInput={(event) => setNote(event.currentTarget.value)}
				placeholder="Note for the assistant (optional)"
				aria-label="Note"
			/>
			<EditActions onCancel={props.onCancel} />
		</form>
	);
}

// Fallback for the payloads without a dedicated form: raw JSON, validated
// server-side against the tool's item schema.
function JsonEditForm(props: EditFormProps) {
	const [raw, setRaw] = createSignal(
		JSON.stringify(props.item.payload, null, 2),
	);
	const [note, setNote] = createSignal("");
	const [parseError, setParseError] = createSignal<string>();
	return (
		<form
			class="flex flex-col gap-row"
			onSubmit={(event) => {
				event.preventDefault();
				try {
					const payload: unknown = JSON.parse(raw());
					setParseError(undefined);
					props.onSubmit(
						payload,
						note().trim() === "" ? undefined : note().trim(),
					);
				} catch {
					setParseError("not valid JSON");
				}
			}}
		>
			<Textarea
				rows={6}
				value={raw()}
				onInput={(event) => setRaw(event.currentTarget.value)}
				aria-label="Payload JSON"
				aria-invalid={parseError() !== undefined}
			/>
			<Show when={parseError()}>
				<Text variant="micro" tone="danger">
					{parseError()}
				</Text>
			</Show>
			<Input
				value={note()}
				onInput={(event) => setNote(event.currentTarget.value)}
				placeholder="Note for the assistant (optional)"
				aria-label="Note"
			/>
			<EditActions onCancel={props.onCancel} />
		</form>
	);
}

function ProposalItem(props: {
	proposal: LoggedProposal;
	item: Item;
	index: number;
}) {
	const [mode, setMode] = createSignal<"view" | "edit" | "reject">("view");
	const [reason, setReason] = createSignal("");
	const [inFlight, setInFlight] = createSignal(false);

	async function resolve(resolution: ProposalResolution): Promise<void> {
		setInFlight(true);
		try {
			await resolveProposalItem(props.proposal.id, props.index, resolution);
			setMode("view");
		} catch {
			// toasted by the store; keep the form open for a retry
		} finally {
			setInFlight(false);
		}
	}

	return (
		<Card>
			<ItemSummary proposal={props.proposal} item={props.item} />
			<Show
				when={props.item.resolution}
				fallback={
					<Switch>
						<Match when={mode() === "view"}>
							<div class="flex gap-row">
								<Button
									size="sm"
									disabled={inFlight()}
									onClick={() => void resolve({ type: "accept" })}
								>
									Accept
								</Button>
								<Button
									size="sm"
									emphasis="secondary"
									disabled={inFlight()}
									onClick={() => setMode("edit")}
								>
									Edit
								</Button>
								<Button
									size="sm"
									emphasis="secondary"
									disabled={inFlight()}
									onClick={() => setMode("reject")}
								>
									Reject
								</Button>
							</div>
						</Match>
						<Match when={mode() === "edit"}>
							<Switch
								fallback={
									<JsonEditForm
										proposal={props.proposal}
										item={props.item}
										onCancel={() => setMode("view")}
										onSubmit={(payload, note) =>
											void resolve({ type: "edit", payload, note })
										}
									/>
								}
							>
								<Match when={props.proposal.tool === "propose_stories"}>
									<StoryEditForm
										proposal={props.proposal}
										item={props.item}
										onCancel={() => setMode("view")}
										onSubmit={(payload, note) =>
											void resolve({ type: "edit", payload, note })
										}
									/>
								</Match>
								<Match when={props.proposal.tool === "update_brief"}>
									<BriefEditForm
										proposal={props.proposal}
										item={props.item}
										onCancel={() => setMode("view")}
										onSubmit={(payload, note) =>
											void resolve({ type: "edit", payload, note })
										}
									/>
								</Match>
							</Switch>
						</Match>
						<Match when={mode() === "reject"}>
							<form
								class="flex flex-col gap-row"
								onSubmit={(event) => {
									event.preventDefault();
									if (reason().trim() === "") return;
									void resolve({
										type: "reject",
										reason: reason().trim(),
									});
								}}
							>
								<Textarea
									rows={2}
									value={reason()}
									onInput={(event) => setReason(event.currentTarget.value)}
									placeholder="Why is this rejected?"
									aria-label="Rejection reason"
								/>
								<div class="flex gap-row">
									<Button
										type="submit"
										size="sm"
										tone="danger"
										disabled={inFlight() || reason().trim() === ""}
									>
										Reject
									</Button>
									<Button
										type="button"
										size="sm"
										emphasis="tertiary"
										onClick={() => setMode("view")}
									>
										Cancel
									</Button>
								</div>
							</form>
						</Match>
					</Switch>
				}
			>
				{(resolution) => resolutionBadge(resolution())}
			</Show>
		</Card>
	);
}

export function ProposalWidget(props: { proposal: LoggedProposal }) {
	const unresolvedCount = () =>
		props.proposal.items.filter((item) => item.resolution === undefined).length;
	return (
		<Card>
			<div class="flex items-center justify-between gap-row">
				<Eyebrow>{TOOL_LABELS[props.proposal.tool]}</Eyebrow>
				<Show when={props.proposal.pending && unresolvedCount() > 1}>
					<Button
						size="sm"
						emphasis="secondary"
						onClick={() => void acceptAllProposalItems(props.proposal)}
					>
						Accept all
					</Button>
				</Show>
			</div>
			<For each={props.proposal.items}>
				{(item, index) => (
					<ProposalItem proposal={props.proposal} item={item} index={index()} />
				)}
			</For>
		</Card>
	);
}
