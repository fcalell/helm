import { procedure } from "virtual:stack-procedure";
import { z } from "@fcalell/plugin-api/schema";
import { storyIdSchema } from "../../board/schema.ts";
import { resolvePermission } from "../../server/services/proposals.ts";
import {
	answerRun,
	pauseRun,
	startRun,
	steerRun,
	stopRun,
} from "../../server/services/runs.ts";

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
	// Steers a running story: kills the live segment and resumes the same
	// session with the interruption notice plus the message. An absent message
	// is the Resume button (a paused run has no process to kill).
	steer: procedure()
		.input(
			z.object({ id: storyIdSchema, message: z.string().min(1).optional() }),
		)
		.handler(({ input }) => steerRun(input.id, input.message)),
	// Pauses a running story: kills the process and returns once the open
	// entry's `paused: true` write landed; the card stays Running.
	pause: procedure()
		.input(z.object({ id: storyIdSchema }))
		.handler(({ input }) => pauseRun(input.id)),
	// Stops a running or needs-input story: closes the open entry blocked
	// ("stopped by the user") and parks the card in Blocked.
	stop: procedure()
		.input(z.object({ id: storyIdSchema }))
		.handler(({ input }) => stopRun(input.id)),
};
