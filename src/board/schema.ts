import { z } from "@fcalell/plugin-api/schema";

export const STATUSES = [
	"backlog",
	"refining",
	"ready",
	"running",
	"needs-input",
	"review",
	"done",
	"blocked",
] as const;

export const statusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof statusSchema>;

export const storyIdSchema = z
	.string()
	.regex(/^\d{3}-\d{2}$/, "story ids are zero-padded <epic>-<story> pairs");

export const runSchema = z.strictObject({
	n: z.number().int().positive(),
	session: z.uuid(),
	started: z.iso.datetime(),
	outcome: z.enum(["review", "blocked"]).optional(),
	tokens: z.number().nonnegative().optional(),
	minutes: z.number().nonnegative().optional(),
});
export type Run = z.infer<typeof runSchema>;

export const storyFrontmatterSchema = z.strictObject({
	id: storyIdSchema,
	status: statusSchema,
	depends: z.array(storyIdSchema).default([]),
	branch: z.string().optional(),
	sessions: z.strictObject({ refine: z.uuid().optional() }).default({}),
	runs: z.array(runSchema).default([]),
});
export type StoryFrontmatter = z.infer<typeof storyFrontmatterSchema>;

export const epicFrontmatterSchema = z.strictObject({
	sessions: z.strictObject({ define: z.uuid().optional() }).default({}),
});
export type EpicFrontmatter = z.infer<typeof epicFrontmatterSchema>;

export const BRIEF_SECTIONS = [
	"Goal",
	"Approach",
	"Acceptance criteria",
	"Out of scope",
	"Open questions",
] as const;
export type BriefSection = (typeof BRIEF_SECTIONS)[number];

export const checklistItemSchema = z.object({
	text: z.string(),
	checked: z.boolean(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const briefSchema = z.object({
	title: z.string(),
	sections: z.record(z.string(), z.string()),
	criteria: z.array(checklistItemSchema),
	openQuestions: z.array(checklistItemSchema),
});
export type Brief = z.infer<typeof briefSchema>;

export const storySchema = z.object({
	id: storyIdSchema,
	epicId: z.string(),
	path: z.string(),
	frontmatter: storyFrontmatterSchema,
	brief: briefSchema,
	body: z.string(),
	raw: z.string(),
});
export type Story = z.infer<typeof storySchema>;

export const epicSchema = z.object({
	id: z.string(),
	slug: z.string(),
	path: z.string(),
	frontmatter: epicFrontmatterSchema,
	title: z.string(),
	body: z.string(),
	raw: z.string(),
});
export type Epic = z.infer<typeof epicSchema>;

export const invalidFileSchema = z.object({
	path: z.string(),
	message: z.string(),
});
export type InvalidFile = z.infer<typeof invalidFileSchema>;

export const boardSchema = z.object({
	epics: z.array(epicSchema),
	stories: z.array(storySchema),
	invalid: z.array(invalidFileSchema),
});
export type Board = z.infer<typeof boardSchema>;

export const illegalTransitionSchema = z.object({
	from: statusSchema,
	to: statusSchema,
	reason: z.string(),
});
export type IllegalTransition = z.infer<typeof illegalTransitionSchema>;

export const boardEventSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("epic-added"), epic: epicSchema }),
	z.object({ kind: z.literal("epic-changed"), epic: epicSchema }),
	z.object({
		kind: z.literal("epic-removed"),
		path: z.string(),
		id: z.string(),
	}),
	z.object({ kind: z.literal("story-added"), story: storySchema }),
	z.object({
		kind: z.literal("story-changed"),
		story: storySchema,
		illegalTransition: illegalTransitionSchema.optional(),
	}),
	z.object({
		kind: z.literal("story-removed"),
		path: z.string(),
		id: z.string(),
	}),
	z.object({
		kind: z.literal("file-invalid"),
		path: z.string(),
		message: z.string(),
	}),
	z.object({ kind: z.literal("invalid-cleared"), path: z.string() }),
	z.object({ kind: z.literal("watch-error"), message: z.string() }),
]);
export type BoardEvent = z.infer<typeof boardEventSchema>;
