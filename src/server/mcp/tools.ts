import { join } from "node:path";
import { z } from "@fcalell/plugin-api/schema";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isENOENT, readShapingFile, shapingDir } from "../../board/store.ts";
import type { BoardToolName, SessionKind } from "../../sessions/kinds.ts";
import { boardSnapshot, managedRepo } from "../services/board.ts";
import {
	hasPendingDecision,
	recordProposal,
	recordQuestion,
} from "../services/proposals.ts";
import type { ReadyBinding } from "./registry.ts";
import type { Proposal } from "./schemas.ts";
import {
	askUserPayloadSchema,
	flagRiskPayloadSchema,
	proposeEpicsPayloadSchema,
	proposeStoriesDefinePayloadSchema,
	proposeStoriesShapePayloadSchema,
	raiseDecisionPayloadSchema,
	resolveQuestionPayloadSchema,
	updateBriefPayloadSchema,
} from "./schemas.ts";

export interface ToolDefinition {
	description: string;
	// The tool's input schema, typed as zod-core's `$ZodType`, the SDK's
	// `AnySchema` branch. Passing the object schema (not a raw shape) validates
	// identically and hands the callback `args: unknown`; the core type is what
	// SDK 1.29's `registerTool` unifies against zod 4.
	inputSchema(kind: SessionKind): z.core.$ZodType;
	handle(binding: ReadyBinding, args: unknown): Promise<CallToolResult>;
}

function ok(text: string): CallToolResult {
	return { content: [{ type: "text", text }] };
}

function err(text: string): CallToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

function recordedProposal(proposal: Proposal): CallToolResult {
	return ok(
		`Recorded proposal ${proposal.id} with ${proposal.items.length} item(s). ` +
			"The user will accept, edit, or reject each item; continue, or end your " +
			"turn and await the outcome.",
	);
}

const RECORDED_SINGLE =
	"Recorded. The user will resolve it; continue or end your turn.";

// The shape gate: a breakdown never outruns the thinking. Open checklist
// items are read from disk (the snapshot can trail an accept by the
// watcher's debounce window); pending raise_decision proposals count too.
async function openDecisions(binding: ReadyBinding): Promise<string[]> {
	const open: string[] = [];
	if (binding.attach?.type === "shaping") {
		const path = join(
			shapingDir(managedRepo().path),
			`${binding.attach.id}.md`,
		);
		try {
			const thread = await readShapingFile(path);
			for (const decision of thread.decisions) {
				if (!decision.checked) open.push(decision.text);
			}
		} catch (error) {
			if (!isENOENT(error)) throw error;
		}
	}
	if (hasPendingDecision(binding.sessionId)) {
		open.push("(a raised decision the user has not resolved yet)");
	}
	return open;
}

export const TOOL_TABLE: Record<BoardToolName, ToolDefinition> = {
	propose_epics: {
		description:
			"Propose one or more epics (optionally with draft stories). Each epic " +
			"renders as a card the user accepts, edits, or rejects; accepting writes " +
			"it to the board.",
		inputSchema: () => proposeEpicsPayloadSchema,
		handle: async (binding, args) => {
			const parsed = proposeEpicsPayloadSchema.safeParse(args);
			if (!parsed.success) return err(z.prettifyError(parsed.error));
			const open = await openDecisions(binding);
			if (open.length > 0) {
				return err(
					"propose_epics is refused while decisions are open. Settle these " +
						`first:\n${open.map((each) => `- ${each}`).join("\n")}`,
				);
			}
			return recordedProposal(
				recordProposal(binding, "propose_epics", parsed.data.epics),
			);
		},
	},
	propose_stories: {
		description:
			"Propose stories for the target epic (named by slug while shaping, or the " +
			"bound epic during breakdown). Each story renders as a card the user " +
			"resolves individually.",
		inputSchema: (kind) =>
			kind === "define"
				? proposeStoriesDefinePayloadSchema
				: proposeStoriesShapePayloadSchema,
		handle: async (binding, args) => {
			if (binding.kind === "define") {
				const parsed = proposeStoriesDefinePayloadSchema.safeParse(args);
				if (!parsed.success) return err(z.prettifyError(parsed.error));
				if (binding.attach?.type !== "epic") {
					return err("this session is not bound to an epic");
				}
				const { goal, rationale } = parsed.data;
				return recordedProposal(
					recordProposal(binding, "propose_stories", parsed.data.stories, {
						epicBody: { goal, rationale },
					}),
				);
			}
			const parsed = proposeStoriesShapePayloadSchema.safeParse(args);
			if (!parsed.success) return err(z.prettifyError(parsed.error));
			const matches = boardSnapshot().epics.filter(
				(epic) => epic.slug === parsed.data.epic,
			);
			if (matches.length === 0) {
				return err(`no epic with slug ${parsed.data.epic}`);
			}
			if (matches.length > 1) {
				return err(`epic slug ${parsed.data.epic} is ambiguous`);
			}
			return recordedProposal(
				recordProposal(binding, "propose_stories", parsed.data.stories, {
					epic: parsed.data.epic,
				}),
			);
		},
	},
	update_brief: {
		description: "Propose replacing one section of this story's brief.",
		inputSchema: () => updateBriefPayloadSchema,
		handle: async (binding, args) => {
			const parsed = updateBriefPayloadSchema.safeParse(args);
			if (!parsed.success) return err(z.prettifyError(parsed.error));
			if (binding.attach?.type !== "story") {
				return err("this session is not bound to a story");
			}
			return recordedProposal(
				recordProposal(binding, "update_brief", [parsed.data]),
			);
		},
	},
	resolve_question: {
		description:
			"Propose resolving one of this story's open questions with an answer.",
		inputSchema: () => resolveQuestionPayloadSchema,
		handle: async (binding, args) => {
			const parsed = resolveQuestionPayloadSchema.safeParse(args);
			if (!parsed.success) return err(z.prettifyError(parsed.error));
			const attach = binding.attach;
			if (attach?.type !== "story") {
				return err("this session is not bound to a story");
			}
			const story = boardSnapshot().stories.find(
				(each) => each.id === attach.id,
			);
			if (story === undefined) return err(`no story with id ${attach.id}`);
			const match = story.brief.openQuestions.find(
				(question) =>
					!question.checked && question.text === parsed.data.question,
			);
			if (match === undefined) {
				return err(
					`no unchecked open question matching "${parsed.data.question}"`,
				);
			}
			return recordedProposal(
				recordProposal(binding, "resolve_question", [parsed.data]),
			);
		},
	},
	raise_decision: {
		description:
			"Raise a feature-level decision that must be settled before breakdown, " +
			"tagged by who can settle it.",
		inputSchema: () => raiseDecisionPayloadSchema,
		handle: async (binding, args) => {
			const parsed = raiseDecisionPayloadSchema.safeParse(args);
			if (!parsed.success) return err(z.prettifyError(parsed.error));
			recordProposal(binding, "raise_decision", [parsed.data]);
			return ok(RECORDED_SINGLE);
		},
	},
	flag_risk: {
		description:
			"Raise a blocking flaw in the brief: name where an implementer would " +
			"stumble.",
		inputSchema: () => flagRiskPayloadSchema,
		handle: async (binding, args) => {
			const parsed = flagRiskPayloadSchema.safeParse(args);
			if (!parsed.success) return err(z.prettifyError(parsed.error));
			recordProposal(binding, "flag_risk", [parsed.data]);
			return ok(RECORDED_SINGLE);
		},
	},
	ask_user: {
		description:
			"Ask the user one question, with your recommended answer and optional " +
			"quick-reply options. End your turn after calling.",
		inputSchema: () => askUserPayloadSchema,
		handle: async (binding, args) => {
			const parsed = askUserPayloadSchema.safeParse(args);
			if (!parsed.success) return err(z.prettifyError(parsed.error));
			const question = recordQuestion(binding, parsed.data);
			return ok(
				`Recorded question ${question.id}. End your turn now; the user's ` +
					"answer arrives as the next message.",
			);
		},
	},
};
