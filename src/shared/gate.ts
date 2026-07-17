import { z } from "@fcalell/plugin-api/schema";
import { storyIdSchema } from "../board/schema.ts";

// Wire shape of the in-memory ready-gate state (pure zod: the SPA bundle
// reaches this through `channels.ts`). One attempt per story; it dies with
// the process, like pending proposals.

export const gateFlagSchema = z.object({
	title: z.string(),
	detail: z.string(),
	// `open` while the refine session's turn may still answer; `contested`
	// awaits the user (accept files an open question, dismiss records an
	// override); `accepted`/`dismissed`/`fixed` are settled.
	status: z.enum(["open", "fixed", "contested", "accepted", "dismissed"]),
	// The refine session's counter-argument; absent on a flag it left
	// unanswered at turn end.
	argument: z.string().optional(),
	// An update_brief fix naming this flag is pending user resolution; the
	// flag is answered, so it never concedes to contested while this holds.
	pendingFix: z.boolean().optional(),
});
export type GateFlag = z.infer<typeof gateFlagSchema>;

export const gateRoundSchema = z.object({
	n: z.number().int().positive(),
	flags: z.array(gateFlagSchema),
});
export type GateRound = z.infer<typeof gateRoundSchema>;

export const gatePhaseSchema = z.enum([
	// Waiting for a dispatcher slot.
	"queued",
	// The cold adversary session is running.
	"adversary",
	// Flags routed; the refine session's answering turn is running.
	"refine",
	// Waiting on the user: contested flags, pending fix proposals, or an
	// accepted flag's open question.
	"review",
	// Two automatic rounds spent; waits for the user to re-run the gate.
	"exhausted",
]);
export type GatePhase = z.infer<typeof gatePhaseSchema>;

export const gateAttemptSchema = z.object({
	storyId: storyIdSchema,
	phase: gatePhaseSchema,
	rounds: z.array(gateRoundSchema),
	// Dismissed flags with their reasons, accumulated across the attempt's
	// rounds; the next round's adversary reads them and a pass records them.
	overrides: z.array(z.string()),
});
export type GateAttempt = z.infer<typeof gateAttemptSchema>;

export const gateSnapshotSchema = z.object({
	attempts: z.array(gateAttemptSchema),
});
export type GateSnapshot = z.infer<typeof gateSnapshotSchema>;

export const gateFlagResolutionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("accept") }),
	z.object({ type: z.literal("dismiss"), reason: z.string().min(1) }),
]);
export type GateFlagResolution = z.infer<typeof gateFlagResolutionSchema>;
