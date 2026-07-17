import { Badge } from "@fcalell/plugin-solid-ui/components/badge";
import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import type {
	EpicDraft,
	Proposal,
	ProposalResolution,
	RaiseDecisionPayload,
	ResolveQuestionPayload,
	StoryDraft,
	UpdateBriefPayload,
} from "../../server/mcp/schemas.ts";
import {
	acceptAllProposalItems,
	type LoggedProposal,
	resolveProposalItem,
} from "../lib/session-store.ts";

const TOOL_LABELS: Record<Proposal["tool"], string> = {
	propose_epics: "Proposed epics",
	propose_stories: "Proposed stories",
	update_brief: "Brief update",
	resolve_question: "Question resolution",
	raise_decision: "Decision",
	flag_risk: "Risk flag",
};

type Item = LoggedProposal["items"][number];

function resolutionBadge(resolution: ProposalResolution) {
	if (resolution.type === "accept") {
		return <Badge variant="success">Accepted</Badge>;
	}
	if (resolution.type === "edit") {
		return <Badge variant="warning">Edit requested</Badge>;
	}
	return <Badge variant="destructive">Rejected</Badge>;
}

function ItemSummary(props: { proposal: LoggedProposal; item: Item }) {
	const payload = () => props.item.payload;
	return (
		<Switch>
			<Match when={props.proposal.tool === "propose_stories"}>
				{(() => {
					const draft = payload() as StoryDraft;
					return (
						<div class="flex flex-col gap-1">
							<p class="text-sm font-semibold">{draft.title}</p>
							<p class="text-sm text-muted-foreground">{draft.goal}</p>
							<div class="flex flex-wrap items-center gap-1.5">
								<Badge variant="outline">{draft.slug}</Badge>
								<For each={draft.depends}>
									{(dep) => <Badge variant="outline">needs {dep}</Badge>}
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
						<div class="flex flex-col gap-1">
							<p class="text-sm font-semibold">{draft.title}</p>
							<p class="text-sm text-muted-foreground">{draft.goal}</p>
							<Show when={draft.rationale}>
								<p class="text-xs text-muted-foreground">{draft.rationale}</p>
							</Show>
							<div class="flex flex-wrap items-center gap-1.5">
								<Badge variant="outline">{draft.slug}</Badge>
								<Show when={draft.stories.length > 0}>
									<Badge variant="outline">
										{draft.stories.length} draft stories
									</Badge>
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
						<div class="flex flex-col gap-1">
							<Badge variant="outline" class="self-start">
								{draft.section}
							</Badge>
							<p class="whitespace-pre-wrap text-sm">{draft.content}</p>
						</div>
					);
				})()}
			</Match>
			<Match when={props.proposal.tool === "resolve_question"}>
				{(() => {
					const draft = payload() as ResolveQuestionPayload;
					return (
						<div class="flex flex-col gap-1">
							<p class="text-sm font-semibold">{draft.question}</p>
							<p class="whitespace-pre-wrap text-sm text-muted-foreground">
								{draft.answer}
							</p>
						</div>
					);
				})()}
			</Match>
			<Match when={props.proposal.tool === "raise_decision"}>
				{(() => {
					const draft = payload() as RaiseDecisionPayload;
					return (
						<div class="flex flex-col gap-1">
							<div class="flex items-center gap-1.5">
								<p class="text-sm font-semibold">{draft.decision}</p>
								<Badge variant="outline">{draft.settledBy}</Badge>
							</div>
							<Show when={draft.context}>
								<p class="text-sm text-muted-foreground">{draft.context}</p>
							</Show>
						</div>
					);
				})()}
			</Match>
			<Match when={true}>
				<pre class="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
					{JSON.stringify(payload(), null, 2)}
				</pre>
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

function StoryEditForm(props: EditFormProps) {
	const draft = props.item.payload as StoryDraft;
	const [slug, setSlug] = createSignal(draft.slug);
	const [title, setTitle] = createSignal(draft.title);
	const [goal, setGoal] = createSignal(draft.goal);
	const [depends, setDepends] = createSignal(draft.depends.join(", "));
	const [note, setNote] = createSignal("");
	return (
		<form
			class="flex flex-col gap-2"
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
				size="sm"
				value={slug()}
				onInput={(event) => setSlug(event.currentTarget.value)}
				placeholder="slug"
				aria-label="Slug"
			/>
			<Input
				size="sm"
				value={title()}
				onInput={(event) => setTitle(event.currentTarget.value)}
				placeholder="Title"
				aria-label="Title"
			/>
			<Textarea
				size="sm"
				rows={2}
				value={goal()}
				onInput={(event) => setGoal(event.currentTarget.value)}
				placeholder="Goal"
				aria-label="Goal"
			/>
			<Input
				size="sm"
				value={depends()}
				onInput={(event) => setDepends(event.currentTarget.value)}
				placeholder="Depends on (slugs, comma-separated)"
				aria-label="Depends on"
			/>
			<Input
				size="sm"
				value={note()}
				onInput={(event) => setNote(event.currentTarget.value)}
				placeholder="Note for the assistant (optional)"
				aria-label="Note"
			/>
			<div class="flex gap-2">
				<Button type="submit" size="sm">
					Send edit
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={props.onCancel}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}

function BriefEditForm(props: EditFormProps) {
	const draft = props.item.payload as UpdateBriefPayload;
	const [content, setContent] = createSignal(draft.content);
	const [note, setNote] = createSignal("");
	return (
		<form
			class="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				props.onSubmit(
					{ section: draft.section, content: content().trim() },
					note().trim() === "" ? undefined : note().trim(),
				);
			}}
		>
			<Badge variant="outline" class="self-start">
				{draft.section}
			</Badge>
			<Textarea
				size="sm"
				rows={6}
				value={content()}
				onInput={(event) => setContent(event.currentTarget.value)}
				aria-label="Section content"
			/>
			<Input
				size="sm"
				value={note()}
				onInput={(event) => setNote(event.currentTarget.value)}
				placeholder="Note for the assistant (optional)"
				aria-label="Note"
			/>
			<div class="flex gap-2">
				<Button type="submit" size="sm">
					Send edit
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={props.onCancel}
				>
					Cancel
				</Button>
			</div>
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
			class="flex flex-col gap-2"
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
				size="sm"
				rows={6}
				value={raw()}
				onInput={(event) => setRaw(event.currentTarget.value)}
				aria-label="Payload JSON"
				aria-invalid={parseError() !== undefined}
			/>
			<Show when={parseError()}>
				<p class="text-xs text-destructive">{parseError()}</p>
			</Show>
			<Input
				size="sm"
				value={note()}
				onInput={(event) => setNote(event.currentTarget.value)}
				placeholder="Note for the assistant (optional)"
				aria-label="Note"
			/>
			<div class="flex gap-2">
				<Button type="submit" size="sm">
					Send edit
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={props.onCancel}
				>
					Cancel
				</Button>
			</div>
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
		<div class="rounded-md border bg-card p-3">
			<ItemSummary proposal={props.proposal} item={props.item} />
			<div class="mt-2">
				<Show
					when={props.item.resolution}
					fallback={
						<Switch>
							<Match when={mode() === "view"}>
								<div class="flex gap-2">
									<Button
										size="sm"
										disabled={inFlight()}
										onClick={() => void resolve({ type: "accept" })}
									>
										Accept
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={inFlight()}
										onClick={() => setMode("edit")}
									>
										Edit
									</Button>
									<Button
										size="sm"
										variant="outline"
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
									class="flex flex-col gap-2"
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
										size="sm"
										rows={2}
										value={reason()}
										onInput={(event) => setReason(event.currentTarget.value)}
										placeholder="Why is this rejected?"
										aria-label="Rejection reason"
									/>
									<div class="flex gap-2">
										<Button
											type="submit"
											size="sm"
											variant="destructive"
											disabled={inFlight() || reason().trim() === ""}
										>
											Reject
										</Button>
										<Button
											type="button"
											size="sm"
											variant="ghost"
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
			</div>
		</div>
	);
}

export function ProposalWidget(props: { proposal: LoggedProposal }) {
	const unresolvedCount = () =>
		props.proposal.items.filter((item) => item.resolution === undefined).length;
	return (
		<div class="flex flex-col gap-2 rounded-lg border border-primary/40 bg-muted/40 p-3">
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground">
					{TOOL_LABELS[props.proposal.tool]}
				</span>
				<Show when={props.proposal.pending && unresolvedCount() > 1}>
					<Button
						size="sm"
						variant="secondary"
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
		</div>
	);
}
