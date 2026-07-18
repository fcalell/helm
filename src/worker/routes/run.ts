import { procedure } from "virtual:stack-procedure";
import { z } from "@fcalell/plugin-api/schema";
import { storyIdSchema } from "../../board/schema.ts";
import { startRun } from "../../server/services/runs.ts";

export const run = {
	// Returns once the story reads `running` on disk (worktree converged,
	// session spawned, run entry written); the run keeps streaming on the
	// `session` WS channel.
	start: procedure()
		.input(z.object({ id: storyIdSchema }))
		.handler(({ input }) => startRun(input.id)),
};
