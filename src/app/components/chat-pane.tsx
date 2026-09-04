import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Loader } from "@fcalell/plugin-solid-ui/components/loader";
import { Row } from "@fcalell/plugin-solid-ui/components/row";
import { Section } from "@fcalell/plugin-solid-ui/components/section";
import { Textarea } from "@fcalell/plugin-solid-ui/components/textarea";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	Match,
	Show,
	Switch,
} from "solid-js";
import {
	activeQuestions,
	type ChatItem,
	chatFor,
	hydrateChat,
	pendingDecisions,
	sendChatMessage,
	sessionStore,
	unanchoredProposals,
} from "../lib/session-store.ts";
import { ArtifactPanel } from "../ui/artifact-panel.tsx";
import { CommandList, CommandRow } from "../ui/command-list.tsx";
import { Conversation } from "./conversation.tsx";
import { DecisionWidget } from "./decision-widget.tsx";
import { ProposalWidget } from "./proposal-widget.tsx";
import { QuestionGroup } from "./question-group.tsx";
import { QuestionWidget } from "./question-widget.tsx";
import { ToolCallLine } from "./tool-call-line.tsx";

const SLASH_COMMANDS = [
	{
		name: "/split",
		hint: "too big — propose a split into two stories",
		prompt:
			"This story is too big. Propose splitting it into two stories, each " +
			"a vertical slice that is demoable on its own.",
	},
	{
		name: "/shrink",
		hint: "cut to the smallest shippable version",
		prompt:
			"Cut this to the smallest shippable version: propose what to drop or " +
			"defer, and what the trimmed scope still delivers.",
	},
	{
		name: "/risks",
		hint: "what could go wrong",
		prompt:
			"What could go wrong with this plan? Name the biggest risks and where " +
			"an implementer would stumble.",
	},
	{
		name: "/estimate",
		hint: "blast radius — what this touches",
		prompt:
			"Estimate the blast radius: which files and modules does this touch? " +
			"Propose the Blast radius section from what you find in the code.",
	},
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number];

function slashMatches(draft: string): SlashCommand[] {
	const text = draft.trim();
	if (!text.startsWith("/")) return [];
	return SLASH_COMMANDS.filter((command) => command.name.startsWith(text));
}

function ToolItem(props: { item: Extract<ChatItem, { type: "tool" }> }) {
	const proposal = () => {
		const id = props.item.proposalId;
		return id === undefined ? undefined : sessionStore.proposals[id];
	};
	const question = () => {
		const id = props.item.questionId;
		return id === undefined ? undefined : sessionStore.questions[id];
	};
	return (
		<Switch fallback={<ToolCallLine item={props.item} />}>
			<Match when={proposal()}>
				{(logged) => <ProposalWidget proposal={logged()} />}
			</Match>
			<Match when={question()}>
				{(logged) => <QuestionWidget question={logged()} />}
			</Match>
		</Switch>
	);
}

export interface ChatPaneProps {
	sessionId: string;
	// The artifact-under-construction slot the chat stories fill.
	artifact?: JSX.Element;
	artifactTitle?: string;
}

export function ChatPane(props: ChatPaneProps) {
	const chat = () => chatFor(props.sessionId);
	const [draft, setDraft] = createSignal("");
	const matches = createMemo(() => slashMatches(draft()));
	// A pending decision or question must be answered through its widget before
	// the composer accepts free text; pending proposals do not defer it (a
	// free-text reply alongside Accept/Edit/Reject is supported).
	const deferred = () =>
		pendingDecisions(props.sessionId).length > 0 ||
		activeQuestions(props.sessionId).length > 0;

	createEffect(() => {
		const sessionId = props.sessionId;
		if (chatFor(sessionId).items.length === 0) void hydrateChat(sessionId);
	});

	function send(): void {
		const text = draft().trim();
		if (text === "" || chat().busy || deferred()) return;
		const command = SLASH_COMMANDS.find((each) => each.name === text);
		setDraft("");
		void sendChatMessage(props.sessionId, command?.prompt ?? text);
	}

	function sendCommand(command: SlashCommand): void {
		if (chat().busy) return;
		setDraft("");
		void sendChatMessage(props.sessionId, command.prompt);
	}

	return (
		<Section>
			<ArtifactPanel title={props.artifactTitle ?? "Artifact"}>
				{props.artifact ?? <p>Nothing under construction yet.</p>}
			</ArtifactPanel>
			<Conversation
				sessionId={props.sessionId}
				renderTool={(item) => <ToolItem item={item} />}
			>
				<For each={unanchoredProposals(props.sessionId, chat().items)}>
					{(proposal) => <ProposalWidget proposal={proposal} />}
				</For>
				<For each={pendingDecisions(props.sessionId)}>
					{(decision) => <DecisionWidget decision={decision} />}
				</For>
				<QuestionGroup sessionId={props.sessionId} />
				<Show when={chat().busy}>
					<Loader text="assistant is working" />
				</Show>
			</Conversation>
			<Show when={matches().length > 0}>
				<CommandList>
					<For each={matches()}>
						{(command) => (
							<CommandRow
								name={command.name}
								hint={command.hint}
								onSelect={() => sendCommand(command)}
							/>
						)}
					</For>
				</CommandList>
			</Show>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					send();
				}}
			>
				<Row>
					<Textarea
						rows={2}
						value={draft()}
						disabled={deferred()}
						onInput={(event) => setDraft(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								send();
							}
						}}
						placeholder={
							deferred()
								? "Answer the question above to continue…"
								: chat().busy
									? "Waiting for the assistant…"
									: "Message the chat…"
						}
						aria-label="Chat message"
					/>
					<Button type="submit" size="sm" disabled={chat().busy || deferred()}>
						Send
					</Button>
				</Row>
			</form>
		</Section>
	);
}
