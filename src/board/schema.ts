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

export const epicIdSchema = z
	.string()
	.regex(/^\d{3}$/, "epic ids are zero-padded three-digit ordinals");

export const runSchema = z.strictObject({
	n: z.number().int().positive(),
	session: z.uuid(),
	brief: z.string(),
	started: z.iso.datetime(),
	outcome: z.enum(["review", "blocked"]).optional(),
	grades: z
		.string()
		.regex(/^\d+\/\d+$/)
		.optional(),
	tokens: z.number().nonnegative().optional(),
	minutes: z.number().nonnegative().optional(),
	error: z.string().optional(),
});
export type Run = z.infer<typeof runSchema>;

export const gateSchema = z.strictObject({
	passed: z.iso.datetime(),
	brief: z.string(),
	overrides: z.array(z.string()).default([]),
});
export type Gate = z.infer<typeof gateSchema>;

export const storyFrontmatterSchema = z.strictObject({
	id: storyIdSchema,
	status: statusSchema,
	depends: z.array(storyIdSchema).default([]),
	branch: z
		.string()
		.regex(/^[^-]/, "branch name must not start with -")
		.optional(),
	gate: gateSchema.optional(),
	sessions: z.strictObject({ refine: z.uuid().optional() }).default({}),
	runs: z.array(runSchema).default([]),
});
export type StoryFrontmatter = z.infer<typeof storyFrontmatterSchema>;

export const epicFrontmatterSchema = z.strictObject({
	sessions: z.strictObject({ define: z.uuid().optional() }).default({}),
});
export type EpicFrontmatter = z.infer<typeof epicFrontmatterSchema>;

export const shapingFrontmatterSchema = z.strictObject({
	sessions: z.strictObject({ shape: z.uuid().optional() }).default({}),
});
export type ShapingFrontmatter = z.infer<typeof shapingFrontmatterSchema>;

export const decisionSettlerSchema = z.enum(["human", "research"]);
export type DecisionSettler = z.infer<typeof decisionSettlerSchema>;

export const decisionItemSchema = z.object({
	text: z.string(),
	checked: z.boolean(),
	settledBy: decisionSettlerSchema,
});
export type DecisionItem = z.infer<typeof decisionItemSchema>;

// The one body section runs append to (through `update_card`); excluded from
// `briefHash`, so notes never stale the gate verdict.
export const RUN_NOTES_SECTION = "Run notes";

export const BRIEF_SECTIONS = [
	"Goal",
	"Approach",
	"Blast radius",
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

export const shapingThreadSchema = z.object({
	slug: z.string(),
	path: z.string(),
	frontmatter: shapingFrontmatterSchema,
	title: z.string(),
	decisions: z.array(decisionItemSchema),
	body: z.string(),
	raw: z.string(),
});
export type ShapingThread = z.infer<typeof shapingThreadSchema>;

export const invalidFileSchema = z.object({
	path: z.string(),
	message: z.string(),
});
export type InvalidFile = z.infer<typeof invalidFileSchema>;

export const boardSchema = z.object({
	epics: z.array(epicSchema),
	stories: z.array(storySchema),
	shaping: z.array(shapingThreadSchema),
	invalid: z.array(invalidFileSchema),
});
export type Board = z.infer<typeof boardSchema>;

// A reason a snapshot cannot carry: shown as a toast. `illegal-transition` is
// an illegal hand edit the watcher accepted (files are the truth) but flags;
// `watch-error` is a filesystem/watcher failure.
export const noticeSchema = z.object({
	kind: z.enum(["illegal-transition", "watch-error"]),
	message: z.string(),
});
export type Notice = z.infer<typeof noticeSchema>;
