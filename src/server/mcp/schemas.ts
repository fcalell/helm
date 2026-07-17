import { z } from "@fcalell/plugin-api/schema";
import { BRIEF_SECTIONS } from "../../board/schema.ts";
import { sessionKindSchema } from "../../sessions/kinds.ts";

// Pure zod, no node imports: the SPA bundle reaches this file through
// `src/shared/channels.ts` (the proposal channel's snapshot schema).

const slugSchema = z
	.string()
	.regex(
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
		"slugs are lowercase words joined by hyphens",
	)
	.max(50);

export const storyDraftSchema = z.object({
	slug: slugSchema,
	title: z.string().min(1),
	goal: z.string().min(1),
	depends: z.array(slugSchema).default([]),
});
export type StoryDraft = z.infer<typeof storyDraftSchema>;

export const epicDraftSchema = z.object({
	slug: slugSchema,
	title: z.string().min(1),
	goal: z.string().min(1),
	rationale: z.string().optional(),
	stories: z.array(storyDraftSchema).default([]),
});
export type EpicDraft = z.infer<typeof epicDraftSchema>;

export const proposeEpicsPayloadSchema = z.object({
	epics: z.array(epicDraftSchema).min(1),
});
// Two variants of propose_stories: shape names the target epic by slug,
// define is bound to its epic and must not name one.
export const proposeStoriesShapePayloadSchema = z.object({
	epic: slugSchema,
	stories: z.array(storyDraftSchema).min(1),
});
export const proposeStoriesDefinePayloadSchema = z.object({
	stories: z.array(storyDraftSchema).min(1),
});
export const updateBriefPayloadSchema = z.object({
	section: z.enum(BRIEF_SECTIONS),
	content: z.string().min(1),
});
export type UpdateBriefPayload = z.infer<typeof updateBriefPayloadSchema>;
export const resolveQuestionPayloadSchema = z.object({
	question: z.string().min(1),
	answer: z.string().min(1),
});
export type ResolveQuestionPayload = z.infer<
	typeof resolveQuestionPayloadSchema
>;
export const raiseDecisionPayloadSchema = z.object({
	decision: z.string().min(1),
	context: z.string().optional(),
	settledBy: z.enum(["human", "research"]),
});
export const flagRiskPayloadSchema = z.object({
	title: z.string().min(1),
	detail: z.string().min(1),
});
export const askUserPayloadSchema = z.object({
	question: z.string().min(1),
	recommendation: z.string().min(1),
	options: z.array(z.string().min(1)).max(6).optional(),
});
export type AskUserPayload = z.infer<typeof askUserPayloadSchema>;

export const proposalResolutionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("accept") }),
	z.object({
		type: z.literal("edit"),
		payload: z.unknown(),
		note: z.string().optional(),
	}),
	z.object({ type: z.literal("reject"), reason: z.string().min(1) }),
]);
export type ProposalResolution = z.infer<typeof proposalResolutionSchema>;

const proposalBase = {
	id: z.uuid(),
	sessionId: z.uuid(),
	kind: sessionKindSchema,
	createdAt: z.iso.datetime(),
};
function itemsOf<S extends z.ZodType>(payload: S) {
	return z
		.array(
			z.object({ payload, resolution: proposalResolutionSchema.optional() }),
		)
		.min(1);
}
export const proposalSchema = z.discriminatedUnion("tool", [
	z.object({
		...proposalBase,
		tool: z.literal("propose_epics"),
		items: itemsOf(epicDraftSchema),
	}),
	z.object({
		...proposalBase,
		tool: z.literal("propose_stories"),
		epic: slugSchema.optional(),
		items: itemsOf(storyDraftSchema),
	}),
	z.object({
		...proposalBase,
		tool: z.literal("update_brief"),
		items: itemsOf(updateBriefPayloadSchema),
	}),
	z.object({
		...proposalBase,
		tool: z.literal("resolve_question"),
		items: itemsOf(resolveQuestionPayloadSchema),
	}),
	z.object({
		...proposalBase,
		tool: z.literal("raise_decision"),
		items: itemsOf(raiseDecisionPayloadSchema),
	}),
	z.object({
		...proposalBase,
		tool: z.literal("flag_risk"),
		items: itemsOf(flagRiskPayloadSchema),
	}),
]);
export type Proposal = z.infer<typeof proposalSchema>;

export const questionSchema = z.object({
	id: z.uuid(),
	sessionId: z.uuid(),
	kind: sessionKindSchema,
	createdAt: z.iso.datetime(),
	...askUserPayloadSchema.shape,
});
export type Question = z.infer<typeof questionSchema>;

export const proposalSnapshotSchema = z.object({
	proposals: z.array(proposalSchema),
	questions: z.array(questionSchema),
});
export type ProposalSnapshot = z.infer<typeof proposalSnapshotSchema>;
