import { z } from "zod";

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
