import { procedure } from "virtual:stack-procedure";
import { z } from "@fcalell/plugin-api/schema";
import { epicIdSchema, storyIdSchema } from "../../board/schema.ts";
import {
	killSession,
	messageSession,
	spawnSession,
} from "../../server/services/sessions.ts";
import { sessionKindSchema } from "../../sessions/kinds.ts";

const spawnInputSchema = z
	.object({
		kind: sessionKindSchema,
		storyId: storyIdSchema.optional(),
		epicId: epicIdSchema.optional(),
		prompt: z.string().min(1),
	})
	.refine((input) => input.kind !== "refine" || input.storyId !== undefined, {
		message: "refine sessions attach to a story: storyId is required",
	})
	.refine((input) => input.kind !== "define" || input.epicId !== undefined, {
		message: "define sessions attach to an epic: epicId is required",
	});

export const session = {
	// Returns once `system/init` announces the session id; the turn keeps
	// streaming over the `session` WS channel after that.
	spawn: procedure()
		.input(spawnInputSchema)
		.handler(({ input }) => spawnSession(input)),
	// Resumes the session with a user message. A stale card-attached session
	// reseeds: the returned id is the fresh session's.
	message: procedure()
		.input(z.object({ sessionId: z.uuid(), prompt: z.string().min(1) }))
		.handler(({ input }) => messageSession(input)),
	kill: procedure()
		.input(z.object({ sessionId: z.uuid() }))
		.handler(({ input }) => killSession(input.sessionId)),
};
