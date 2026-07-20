import { procedure } from "virtual:stack-procedure";
import { z } from "@fcalell/plugin-api/schema";
import { storyIdSchema } from "../../board/schema.ts";
import { resolvePermission } from "../../server/services/proposals.ts";
import { answerRun, startRun } from "../../server/services/runs.ts";

export const run = {
	// Returns once the story reads `running` on disk (worktree converged,
	// session spawned, run entry written); the run keeps streaming on the
	// `session` WS channel.
	start: procedure()
		.input(z.object({ id: storyIdSchema }))
		.handler(({ input }) => startRun(input.id)),
	// Resolves a held permission prompt: approve releases the exact call, deny
	// lands in the session as the denial message.
	permission: procedure()
		.input(z.object({ id: z.uuid(), approved: z.boolean() }))
		.handler(({ input }) => {
			resolvePermission(input.id, input.approved);
		}),
	// Answers a needs-input card: resumes the entry's session in the worktree
	// with the answer and flips the card back to running.
	answer: procedure()
		.input(z.object({ id: storyIdSchema, answer: z.string().min(1) }))
		.handler(({ input }) => answerRun(input.id, input.answer)),
};
