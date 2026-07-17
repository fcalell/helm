import { procedure } from "virtual:stack-procedure";
import { z } from "@fcalell/plugin-api/schema";
import { createEpicEntry } from "../../server/services/board.ts";

export const epic = {
	// The `n` entry: writes the epic folder with the next free ordinal and
	// returns its id; the caller spawns the define chat against it.
	create: procedure()
		.input(z.object({ title: z.string().min(1), goal: z.string().min(1) }))
		.handler(({ input }) => createEpicEntry(input)),
};
