import { procedure } from "virtual:stack-procedure";
import { z } from "@fcalell/plugin-api/schema";
import { resolveShapingDecision } from "../../server/services/proposals.ts";

export const shaping = {
	// The checklist path of decision resolution: checks the item off, folds
	// the answer into the agreed notes, and resumes the thread's shape session.
	resolveDecision: procedure()
		.input(
			z.object({
				slug: z.string().min(1),
				decision: z.string().min(1),
				answer: z.string().min(1),
			}),
		)
		.handler(({ input }) => resolveShapingDecision(input)),
};
