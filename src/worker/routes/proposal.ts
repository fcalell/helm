import { procedure } from "virtual:stack-procedure";
import { z } from "@fcalell/plugin-api/schema";
import { proposalResolutionSchema } from "../../server/mcp/schemas.ts";
import {
	answerQuestion,
	answerQuestions,
	resolveProposalItem,
} from "../../server/services/proposals.ts";

export const proposal = {
	// Per-item resolution; the proposal channel's snapshot is the authority, so
	// nothing is returned. Board writes serialize through the write queue; a
	// fully resolved proposal with edits/rejections resumes the session (held
	// until its turn ends if it is mid-turn).
	resolve: procedure()
		.input(
			z.object({
				proposalId: z.uuid(),
				item: z.number().int().nonnegative(),
				resolution: proposalResolutionSchema,
			}),
		)
		.handler(({ input }) => resolveProposalItem(input)),
	// Answers a pending ask_user question and resumes the session with it.
	answer: procedure()
		.input(z.object({ questionId: z.uuid(), answer: z.string().min(1) }))
		.handler(({ input }) => answerQuestion(input)),
	// Answers every pending question in one session with a single resume; the
	// question group submits its whole answer map here.
	answerAll: procedure()
		.input(
			z.object({
				answers: z
					.array(z.object({ questionId: z.uuid(), answer: z.string().min(1) }))
					.min(1),
			}),
		)
		.handler(({ input }) => answerQuestions(input)),
};
