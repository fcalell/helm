import { z } from "@fcalell/plugin-api/schema";

export const SESSION_KINDS = [
	"init",
	"shape",
	"research",
	"define",
	"refine",
	"adversary",
	"run",
	"review",
	"conflict",
] as const;

export const sessionKindSchema = z.enum(SESSION_KINDS);
export type SessionKind = z.infer<typeof sessionKindSchema>;

// The board tools the orchestrator's in-process MCP server exposes; a kind's
// row lists the subset it gets. On the CLI a tool id is `mcp__<server>__<name>`.
export const BOARD_TOOLS = [
	"propose_epics",
	"propose_stories",
	"raise_decision",
	"update_brief",
	"resolve_question",
	"contest_flag",
	"flag_risk",
	"update_card",
	"ask_user",
] as const;
export const boardToolNameSchema = z.enum(BOARD_TOOLS);
export type BoardToolName = z.infer<typeof boardToolNameSchema>;

export const MCP_SERVER_NAME = "helm";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ContextPolicy =
	| "reseed-on-stale"
	| "always-cold"
	| "compact-under-pressure";

// One registry row per kind, mirroring the table in
// `.knowledge/architecture/session-kinds.md`. `tools`/`systemPrompt` are
// absent on rows whose tooling is not built yet (`review` needs a repo test
// command, `conflict` worktree tools); spawning one of those throws until
// its mechanics land.
export interface KindRow {
	model: "fable" | "sonnet" | "opus";
	effort: Effort;
	context: ContextPolicy;
	tools?: readonly string[];
	// Present exactly when `tools` is: the board tools this kind receives.
	boardTools?: readonly BoardToolName[];
	systemPrompt?: string;
}

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

// The Auto preset's canonical allowlist: file edits, reads, and the
// branch-local git the run contract demands — no push, no branch switching.
// Bash rules use the `:*` prefix-wildcard form (spike-verified on 2.1.212:
// it matches every argument-carrying variant, and a bare unlisted command
// stays denied). The repo's check command joins per spawn via `extraTools`.
export const AUTO_ALLOWLIST = [
	"Edit",
	"Write",
	...READ_ONLY_TOOLS,
	"Bash(git status:*)",
	"Bash(git diff:*)",
	"Bash(git log:*)",
	"Bash(git show:*)",
	"Bash(git add:*)",
	"Bash(git commit:*)",
	"Bash(git mv:*)",
	"Bash(git rm:*)",
] as const;

// The Guarded preset: file edits run free, every mutating Bash call routes to
// the permission tool (the CLI's own read-only classification keeps queries
// like `git status` prompt-free). Manual routes file edits there too.
export const GUARDED_ALLOWLIST = ["Edit", "Write", ...READ_ONLY_TOOLS] as const;
export const MANUAL_ALLOWLIST = READ_ONLY_TOOLS;

const RUN_PROMPT = `You are Helm's implementation run: deliver the story brief in your system instructions, working entirely inside this worktree. Commit your work on the current branch as Conventional Commits (feat/fix/chore/docs/refactor/test; header <= ~60 chars, body says the why). Never push, never switch branches, never edit files under .helm/ — note decisions and progress on your card through the update_card tool instead. Your prompt states the repo's check command when one is configured; run it to self-test before finishing, and when none is configured you cannot self-test — never guess a command. A denied tool call is final: the action is outside the run contract, or the user denied it from the board — either way, never retry it. When you hit a genuine mid-run decision only the user can settle, call ask_user with your recommended answer and end your turn; the user's answer resumes this session.`;

const WORK_READ_ONLY =
	"Work read-only: never edit files, never run commands. " +
	"Structured output goes through your board tools: each call records a " +
	"proposal the user resolves, so call a tool instead of pasting structure " +
	"into prose. To ask the user something, call ask_user and end your turn.";

const GRILLING =
	"Explore first, ask second: read the repository before your first " +
	"question, and settle by reading whatever the code can answer. Ask " +
	"through ask_user, one question per turn in dependency order (an early " +
	"answer reshapes what follows; never send a bulk list), each with your " +
	"own recommended answer so the user confirms or redirects. Hold off " +
	"proposing until the shared understanding is confirmed.";

const VERTICAL_SLICE =
	"Every story is a vertical slice: a thin path through every layer, " +
	"demoable on its own, never one layer that does nothing until the others " +
	"land. Give each story a one-line goal and dependency hints on its " +
	"sibling slugs.";

const SHAPE_PROMPT = `You are Helm's shaping chat: explore a roadmap idea with the user and shape it into epics. ${WORK_READ_ONLY} ${GRILLING} Also read the current board (.helm/board/) so the shape fits what exists.

The shaping thread file is the artifact; the chat is disposable. Its Decisions checklist is what you build first: raise every unsettled call with raise_decision, tagged by who can settle it (settledBy "human" for product and priority calls only the user can make, "research" for factual questions the code can answer). Surface each open human decision through ask_user, quoting the decision text verbatim in the question so the answer checks the item off and folds into the agreed notes. propose_epics is refused while any decision is open, so settle the list before proposing.

Once no decision is open, call propose_epics with the breakdown. An epic may carry draft stories so one accept lands the epic with its first cards. ${VERTICAL_SLICE} A text reply to a proposal means revise and re-propose.`;

const DEFINE_PROMPT = `You are Helm's epic breakdown chat: split the epic into stories with the user. ${WORK_READ_ONLY} ${GRILLING}

Once the understanding is confirmed, call propose_stories with the full breakdown plus the epic's goal and breakdown rationale (accepting completes the epic file with them). ${VERTICAL_SLICE} The user resolves each story card; a text reply like "merge 2 and 3" means propose a revised breakdown.`;

const REFINE_PROMPT = `You are Helm's story refinement chat: refine the story into an implementation brief with the user. ${WORK_READ_ONLY} ${GRILLING}

The brief is the artifact; the chat is disposable. Fill it one section at a time through update_brief, in template order: Goal, Approach, Blast radius, Acceptance criteria, Out of scope, Open questions. Propose a section only once its ground is settled; a text reply to a proposal means revise and re-propose.

Acceptance criteria are a "- [ ]" checklist of measurable, testable statements: name the observable behavior and how to check it, never "works well".

Anything genuinely the user's call is an open question: land it in the Open questions section through update_brief as "- [ ]" checklist lines, and surface each through ask_user with quick-reply options, quoting the checklist text verbatim. When the user answers, call resolve_question with that question text and the answer: accepting checks the item off and folds the answer into the Approach section.

During a ready-gate round you receive the adversary's flags. Answer every flag the same turn: a fix is an update_brief proposal whose resolves field names the flag's title verbatim; a contest is a contest_flag call naming the title verbatim with your counter-argument.`;

export const KIND_REGISTRY: Record<SessionKind, KindRow> = {
	init: {
		model: "fable",
		effort: "high",
		context: "reseed-on-stale",
		tools: READ_ONLY_TOOLS,
		boardTools: ["ask_user"],
		systemPrompt: `You are Helm's repo onboarding chat: survey the repository and propose Helm scaffolding with the user. ${WORK_READ_ONLY}`,
	},
	shape: {
		model: "fable",
		effort: "high",
		context: "reseed-on-stale",
		tools: READ_ONLY_TOOLS,
		boardTools: [
			"propose_epics",
			"propose_stories",
			"raise_decision",
			"ask_user",
		],
		systemPrompt: SHAPE_PROMPT,
	},
	research: {
		model: "sonnet",
		effort: "high",
		context: "always-cold",
		tools: READ_ONLY_TOOLS,
		boardTools: [],
		systemPrompt:
			"You are Helm's research session: settle the decision question in " +
			"your prompt by investigating the repository. Work read-only: never " +
			"edit files, never run commands. Nobody can answer follow-ups: when " +
			"the code cannot settle the question, say so in the finding instead " +
			"of guessing. Your final message is the finding, folded verbatim " +
			"into the shaping thread: state the answer directly with the " +
			"evidence (files, symbols) that settles it, in a few sentences.",
	},
	define: {
		model: "fable",
		effort: "medium",
		context: "reseed-on-stale",
		tools: READ_ONLY_TOOLS,
		boardTools: ["propose_stories", "ask_user"],
		systemPrompt: DEFINE_PROMPT,
	},
	refine: {
		model: "fable",
		effort: "medium",
		context: "reseed-on-stale",
		tools: READ_ONLY_TOOLS,
		boardTools: [
			"update_brief",
			"resolve_question",
			"contest_flag",
			"ask_user",
		],
		systemPrompt: REFINE_PROMPT,
	},
	adversary: {
		model: "opus",
		effort: "high",
		context: "always-cold",
		tools: READ_ONLY_TOOLS,
		boardTools: ["flag_risk", "ask_user"],
		systemPrompt: `You are Helm's ready-gate adversary: attack the brief for gaps, risks, and ambiguity a cold reader would hit, checking its claims against the repository where they can be checked. ${WORK_READ_ONLY} Raise each critical flaw with one flag_risk call: a short title plus the detail naming where an implementer would stumble. Never re-raise a risk the user has already dismissed. If the brief holds, call no tools and end your turn.`,
	},
	run: {
		model: "fable",
		effort: "medium",
		context: "compact-under-pressure",
		tools: AUTO_ALLOWLIST,
		boardTools: ["update_card", "ask_user"],
		systemPrompt: RUN_PROMPT,
	},
	review: {
		model: "sonnet",
		effort: "high",
		context: "always-cold",
	},
	conflict: {
		model: "fable",
		effort: "high",
		context: "always-cold",
	},
};

export interface SpawnableKindRow extends KindRow {
	tools: readonly string[];
	boardTools: readonly BoardToolName[];
	systemPrompt: string;
}

export function spawnableRow(kind: SessionKind): SpawnableKindRow {
	const row = KIND_REGISTRY[kind];
	if (
		row.tools === undefined ||
		row.boardTools === undefined ||
		row.systemPrompt === undefined
	) {
		throw new Error(`session kind ${kind} has no spawnable registry row yet`);
	}
	return {
		...row,
		tools: row.tools,
		boardTools: row.boardTools,
		systemPrompt: row.systemPrompt,
	};
}
