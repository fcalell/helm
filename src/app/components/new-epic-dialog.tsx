import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Dialog } from "@fcalell/plugin-solid-ui/components/dialog";
import { Input } from "@fcalell/plugin-solid-ui/components/input";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createSignal } from "solid-js";
import { api } from "../lib/api.ts";
import { spawnDefineSession } from "../lib/session-store.ts";
import type { DefineTarget } from "./define-drawer.tsx";

export interface NewEpicDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (target: DefineTarget) => void;
}

export function NewEpicDialog(props: NewEpicDialogProps) {
	const [title, setTitle] = createSignal("");
	const [rough, setRough] = createSignal("");
	const [creating, setCreating] = createSignal(false);

	async function create(): Promise<void> {
		const titleText = title().trim();
		const roughText = rough().trim();
		if (titleText === "" || roughText === "") return;
		setCreating(true);
		try {
			const { epicId } = await api.epic.create({
				title: titleText,
				goal: roughText,
			});
			const sessionId = await spawnDefineSession(
				epicId,
				`${titleText}\n\n${roughText}`,
			);
			props.onOpenChange(false);
			setTitle("");
			setRough("");
			props.onCreated({ epicId, sessionId });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "failed to create the epic",
			);
		} finally {
			setCreating(false);
		}
	}

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>New epic</Dialog.Title>
					<Dialog.Description>
						A title and a rough paragraph, as messy as you like; the define chat
						breaks it into stories.
					</Dialog.Description>
				</Dialog.Header>
				<form
					class="flex flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					<Input
						value={title()}
						onInput={(event) => setTitle(event.currentTarget.value)}
						placeholder="Title"
						aria-label="Epic title"
					/>
					<Textarea
						rows={4}
						value={rough()}
						onInput={(event) => setRough(event.currentTarget.value)}
						placeholder="What is this epic about?"
						aria-label="Rough description"
					/>
					<Button
						type="submit"
						class="self-end"
						disabled={
							creating() || title().trim() === "" || rough().trim() === ""
						}
					>
						{creating() ? "Creating…" : "Create epic & start chat"}
					</Button>
				</form>
			</Dialog.Content>
		</Dialog>
	);
}
