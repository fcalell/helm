import { z } from "@fcalell/plugin-api/schema";
import { storyIdSchema } from "../board/schema.ts";
import { sessionKindSchema } from "../sessions/kinds.ts";

// Wire shape of the queue occupancy and rate-limit meter (pure zod: the SPA
// bundle reaches this through `channels.ts`). In-memory only; a restart
// clears it, which only widens the meter's lower-bound underestimate.

export const queueEntrySchema = z.object({
	kind: sessionKindSchema,
	storyId: storyIdSchema.optional(),
});
export type QueueEntry = z.infer<typeof queueEntrySchema>;

export const meterQueueSchema = z.object({
	cap: z.number().int().positive(),
	running: z.array(queueEntrySchema),
	queued: z.array(queueEntrySchema),
});
export type MeterQueue = z.infer<typeof meterQueueSchema>;

// One entry per window type the CLI has reported (`five_hour` observed
// today); `resetsAt` is unix seconds.
export const meterWindowSchema = z.object({
	windowType: z.string(),
	status: z.string(),
	resetsAt: z.number(),
});
export type MeterWindow = z.infer<typeof meterWindowSchema>;

export const meterSnapshotSchema = z.object({
	queue: meterQueueSchema,
	windows: z.array(meterWindowSchema),
	// Lower-bound token sums over every kind's result events: the 5-hour
	// window since its reset minus 5h (trailing 5h when the reset is stale),
	// and the trailing 7 days.
	tokens: z.object({ fiveHour: z.number(), week: z.number() }),
});
export type MeterSnapshot = z.infer<typeof meterSnapshotSchema>;
