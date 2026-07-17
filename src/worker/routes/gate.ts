import { procedure } from "virtual:stack-procedure";
import { z } from "@fcalell/plugin-api/schema";
import { storyIdSchema } from "../../board/schema.ts";
import { resolveGateFlag } from "../../server/services/gate.ts";
import { gateFlagResolutionSchema } from "../../shared/gate.ts";

export const gate = {
	// User resolution of a contested gate flag: accept files it as an open
	// question on the brief, dismiss records the override reason. Returns
	// nothing; the `gate` channel snapshot is the authority.
	resolveFlag: procedure()
		.input(
			z.object({
				storyId: storyIdSchema,
				flag: z.string().min(1),
				resolution: gateFlagResolutionSchema,
			}),
		)
		.handler(({ input }) => resolveGateFlag(input)),
};
