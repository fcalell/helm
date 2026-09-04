import { Button } from "@fcalell/plugin-solid-ui/components/button";
import { Card } from "@fcalell/plugin-solid-ui/components/card";
import { Row } from "@fcalell/plugin-solid-ui/components/row";
import { Text } from "@fcalell/plugin-solid-ui/components/text";
import { createSignal, Match, Show, Switch } from "solid-js";
import type { Status, Story } from "../../board/schema.ts";
import { moveStory } from "../lib/board-store.ts";
import { meterStore } from "../lib/meter-store.ts";
import {
	refineSpawnFor,
	spawnRefineSession,
	startStoryRun,
} from "../lib/session-store.ts";
import { Eyebrow } from "../ui/eyebrow.tsx";
import { ReviewExits } from "./review-exits.tsx";
import { RunQuestionPanel } from "./run-question-panel.tsx";

// What each status means and the one action that moves the story on. The
// board's cards stay passive; this block is where the loop explains itself.
const STAGES: Record<Status, { eyebrow: string; line: string }> = {
	backlog: {
		eyebrow: "Next step",
		line: "No brief yet. Refining opens a chat where Claude reads the code and drafts the brief with you.",
	},
	refining: {
		eyebrow: "Next step",
		line: "The brief takes shape in Chat. Move to Ready sends it through the adversary gate; the card moves when it passes.",
	},
	ready: {
		eyebrow: "Next step",
		line: "The brief passed the gate. Run implements it in a worktree and lands the result in Review.",
	},
	running: {
		eyebrow: "In progress",
		line: "A run is implementing the brief. Activity follows it live.",
	},
	"needs-input": {
		eyebrow: "Waiting on you",
		line: "The run stopped on a question. Answer it to resume.",
	},
	review: {
		eyebrow: "Next step",
		line: "The run finished. Read the diff, then approve, request changes, or discard.",
	},
	done: {
		eyebrow: "Done",
		line: "Merged into main.",
	},
	blocked: {
		eyebrow: "Parked",
		line: "Drag the card to Backlog, Refining, or Ready to resume.",
	},
};

// The open run entry's pending question (frontmatter is the truth the panel
// renders from).
function openRunQuestion(story: Story) {
	return story.frontmatter.runs.findLast((run) => run.outcome === undefined)
		?.question;
}

function RefineAction(props: { story: Story; onOpenChat: () => void }) {
	const hasChat = () =>
		props.story.frontmatter.sessions.refine !== undefined ||
		refineSpawnFor(props.story.id) !== undefined;

	function start(): void {
		if (!hasChat()) void spawnRefineSession(props.story.id);
		props.onOpenChat();
	}

	return (
		<Button size="sm" onClick={start}>
			{hasChat() ? "Open chat" : "Start refining"}
		</Button>
	);
}

function RunAction(props: { story: Story }) {
	const [starting, setStarting] = createSignal(false);
	const queued = () =>
		meterStore.snapshot?.queue.queued.some(
			(entry) => entry.kind === "run" && entry.storyId === props.story.id,
		) === true;

	async function run(): Promise<void> {
		setStarting(true);
		try {
			await startStoryRun(props.story.id);
		} finally {
			setStarting(false);
		}
	}

	return (
		<Button
			size="sm"
			disabled={starting() || queued()}
			onClick={() => void run()}
		>
			{queued() ? "Queued" : "Run"}
		</Button>
	);
}

export function StageBlock(props: { story: Story; onOpenChat: () => void }) {
	const status = () => props.story.frontmatter.status;
	const stage = () => STAGES[status()];

	return (
		<Card data-stage={status()}>
			<Card.Header>
				<Eyebrow>{stage().eyebrow}</Eyebrow>
				<Text variant="caption" tone="ink-3">
					{stage().line}
				</Text>
			</Card.Header>
			<Switch>
				<Match when={status() === "backlog"}>
					<Row>
						<RefineAction story={props.story} onOpenChat={props.onOpenChat} />
					</Row>
				</Match>
				<Match when={status() === "refining"}>
					<Row>
						<Button
							size="sm"
							onClick={() => moveStory(props.story.id, "ready")}
						>
							Move to Ready
						</Button>
					</Row>
				</Match>
				<Match when={status() === "ready"}>
					<Row>
						<RunAction story={props.story} />
					</Row>
				</Match>
				<Match when={status() === "needs-input"}>
					<Show when={openRunQuestion(props.story)}>
						{(question) => (
							<RunQuestionPanel
								storyId={props.story.id}
								question={question()}
							/>
						)}
					</Show>
				</Match>
				<Match when={status() === "review"}>
					<ReviewExits story={props.story} />
				</Match>
			</Switch>
		</Card>
	);
}
