import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Dialog } from "@fcalell/plugin-solid-ui/components/dialog";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createSignal, For, Show } from "solid-js";
import type { Story } from "../../board/schema.ts";
import { api } from "../lib/api.ts";

type ConfirmExit = "approve" | "discard";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// The three review exits, shown whatever the active tab. No optimistic
// state: after approve or discard the board snapshot moves the card, and a
// successful request-changes flips the card to Running (the drawer's default
// tab follows).
export function ReviewExits(props: { story: Story }) {
	const [busy, setBusy] = createSignal(false);
	const [confirming, setConfirming] = createSignal<ConfirmExit>();
	const [requestOpen, setRequestOpen] = createSignal(false);

	async function run(call: () => Promise<void>): Promise<void> {
		setBusy(true);
		try {
			await call();
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			setBusy(false);
		}
	}

	async function approve(): Promise<void> {
		setConfirming(undefined);
		await run(async () => {
			const result = await api.review.approve({ storyId: props.story.id });
			if (result.pushError !== undefined) {
				toast.error(`Merged, but the push failed: ${result.pushError}`);
			}
		});
	}

	async function discard(): Promise<void> {
		setConfirming(undefined);
		await run(() => api.review.discard({ storyId: props.story.id }));
	}

	return (
		<div class="flex items-center gap-2">
			<Button
				size="sm"
				disabled={busy()}
				onClick={() => setConfirming("approve")}
			>
				Approve
			</Button>
			<Button
				size="sm"
				variant="secondary"
				disabled={busy()}
				onClick={() => setRequestOpen(true)}
			>
				Request changes
			</Button>
			<Button
				size="sm"
				variant="outline"
				class="text-destructive"
				disabled={busy()}
				onClick={() => setConfirming("discard")}
			>
				Discard
			</Button>
			<Dialog
				open={confirming() !== undefined}
				onOpenChange={(open) => {
					if (!open) setConfirming(undefined);
				}}
			>
				<Dialog.Content>
					<Show
						when={confirming() === "approve"}
						fallback={
							<>
								<Dialog.Header>
									<Dialog.Title>Discard this attempt?</Dialog.Title>
									<Dialog.Description>
										The worktree and the story branch are deleted. The brief and
										the run history stay, and the story lands back in Ready.
									</Dialog.Description>
								</Dialog.Header>
								<Dialog.Footer>
									<Button
										variant="secondary"
										onClick={() => setConfirming(undefined)}
									>
										Cancel
									</Button>
									<Button variant="destructive" onClick={() => void discard()}>
										Discard
									</Button>
								</Dialog.Footer>
							</>
						}
					>
						<Dialog.Header>
							<Dialog.Title>Approve and merge?</Dialog.Title>
							<Dialog.Description>
								The story branch is rebased if main moved, fast-forward-merged
								into main, and pushed when an upstream exists; the worktree and
								branch are then deleted and the card moves to Done.
							</Dialog.Description>
						</Dialog.Header>
						<Dialog.Footer>
							<Button
								variant="secondary"
								onClick={() => setConfirming(undefined)}
							>
								Cancel
							</Button>
							<Button onClick={() => void approve()}>Approve</Button>
						</Dialog.Footer>
					</Show>
				</Dialog.Content>
			</Dialog>
			<RequestChangesDialog
				story={props.story}
				open={requestOpen()}
				onOpenChange={setRequestOpen}
				busy={busy()}
				onSubmit={(comments) =>
					run(async () => {
						await api.review.requestChanges({
							storyId: props.story.id,
							comments,
						});
						setRequestOpen(false);
					})
				}
			/>
		</div>
	);
}

interface RequestComment {
	criterion?: string;
	text: string;
}

function RequestChangesDialog(props: {
	story: Story;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	busy: boolean;
	onSubmit: (comments: RequestComment[]) => Promise<void>;
}) {
	const [perCriterion, setPerCriterion] = createSignal<Record<number, string>>(
		{},
	);
	const [freeForm, setFreeForm] = createSignal("");

	const comments = (): RequestComment[] => {
		const items: RequestComment[] = props.story.brief.criteria.flatMap(
			(criterion, index) => {
				const text = (perCriterion()[index] ?? "").trim();
				return text === "" ? [] : [{ criterion: criterion.text, text }];
			},
		);
		if (freeForm().trim() !== "") items.push({ text: freeForm().trim() });
		return items;
	};

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>Request changes</Dialog.Title>
					<Dialog.Description>
						Comments become the next message in the same run session, in the
						same worktree; the card goes back to Running.
					</Dialog.Description>
				</Dialog.Header>
				<form
					class="flex flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						void props.onSubmit(comments());
					}}
				>
					<For each={props.story.brief.criteria}>
						{(criterion, index) => (
							<div class="flex flex-col gap-1 text-sm">
								<span class="text-muted-foreground">{criterion.text}</span>
								<Textarea
									rows={1}
									size="sm"
									value={perCriterion()[index()] ?? ""}
									onInput={(event) =>
										setPerCriterion({
											...perCriterion(),
											[index()]: event.currentTarget.value,
										})
									}
									aria-label={`Comment on: ${criterion.text}`}
									placeholder="What is wrong with this criterion? (optional)"
								/>
							</div>
						)}
					</For>
					<div class="flex flex-col gap-1 text-sm">
						<span class="text-muted-foreground">Anything else</span>
						<Textarea
							rows={3}
							value={freeForm()}
							onInput={(event) => setFreeForm(event.currentTarget.value)}
							aria-label="Free-form change request"
							placeholder="Free-form change request (optional)"
						/>
					</div>
					<Button
						type="submit"
						class="self-end"
						disabled={props.busy || comments().length === 0}
					>
						Send change requests
					</Button>
				</form>
			</Dialog.Content>
		</Dialog>
	);
}
