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

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ContextPolicy =
	| "reseed-on-stale"
	| "always-cold"
	| "compact-under-pressure";

// One registry row per kind, mirroring the table in
// `.knowledge/architecture/session-kinds.md`. `tools`/`systemPrompt` are
// absent on rows whose tooling is not built yet (`run` needs permission
// presets, `review` a repo test command, `conflict` worktree tools);
// spawning one of those throws until its mechanics land.
export interface KindRow {
	model: "fable" | "sonnet";
	effort: Effort;
	context: ContextPolicy;
	tools?: readonly string[];
	systemPrompt?: string;
}

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

const WORK_READ_ONLY =
	"Work read-only: never edit files, never run commands. " +
	"Structured output goes through your board tools once they are available; " +
	"until then, answer in plain prose.";

export const KIND_REGISTRY: Record<SessionKind, KindRow> = {
	init: {
		model: "fable",
		effort: "high",
		context: "reseed-on-stale",
		tools: READ_ONLY_TOOLS,
		systemPrompt: `You are Helm's repo onboarding chat: survey the repository and propose Helm scaffolding with the user. ${WORK_READ_ONLY}`,
	},
	shape: {
		model: "fable",
		effort: "high",
		context: "reseed-on-stale",
		tools: READ_ONLY_TOOLS,
		systemPrompt: `You are Helm's shaping chat: explore a roadmap idea with the user and shape it toward epics. ${WORK_READ_ONLY}`,
	},
	research: {
		model: "sonnet",
		effort: "high",
		context: "always-cold",
		tools: READ_ONLY_TOOLS,
		systemPrompt: `You are Helm's research session: investigate the given question against the repository and report your findings. ${WORK_READ_ONLY}`,
	},
	define: {
		model: "fable",
		effort: "medium",
		context: "reseed-on-stale",
		tools: READ_ONLY_TOOLS,
		systemPrompt: `You are Helm's epic breakdown chat: split the epic into stories with the user. ${WORK_READ_ONLY}`,
	},
	refine: {
		model: "fable",
		effort: "medium",
		context: "reseed-on-stale",
		tools: READ_ONLY_TOOLS,
		systemPrompt: `You are Helm's story refinement chat: refine the story into an implementation brief with the user. ${WORK_READ_ONLY}`,
	},
	adversary: {
		model: "fable",
		effort: "high",
		context: "always-cold",
		tools: READ_ONLY_TOOLS,
		systemPrompt: `You are Helm's ready-gate adversary: attack the brief for gaps, risks, and ambiguity a cold reader would hit. ${WORK_READ_ONLY}`,
	},
	run: {
		model: "fable",
		effort: "high",
		context: "compact-under-pressure",
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
	systemPrompt: string;
}

export function spawnableRow(kind: SessionKind): SpawnableKindRow {
	const row = KIND_REGISTRY[kind];
	if (row.tools === undefined || row.systemPrompt === undefined) {
		throw new Error(`session kind ${kind} has no spawnable registry row yet`);
	}
	return { ...row, tools: row.tools, systemPrompt: row.systemPrompt };
}
