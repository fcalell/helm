import { appendFileSync, readFileSync } from "node:fs";
import { z } from "@fcalell/plugin-api/schema";
import { sessionKindSchema } from "../../src/sessions/kinds.ts";
import { parsedArgvSchema } from "./argv.ts";

// The spawn ledger every episode is read from: one JSONL line per event, in
// a file the driver never truncates mid-episode. Appends are single write()
// calls in O_APPEND mode, so overlapping spawns interleave lines, never
// characters.

export const stubLogEntrySchema = z.discriminatedUnion("t", [
	z.object({
		t: z.literal("start"),
		at: z.iso.datetime(),
		pid: z.number().int(),
		kind: sessionKindSchema.nullable(),
		script: z.string().nullable(),
		failure: z.string().optional(),
		env: z.object({
			scripts: z.string().nullable(),
			log: z.string().nullable(),
			path: z.string(),
		}),
		argv: z.array(z.string()),
		parsed: parsedArgvSchema,
	}),
	z.object({
		t: z.literal("call"),
		at: z.iso.datetime(),
		pid: z.number().int(),
		tool: z.string(),
		attempt: z.number().int().positive(),
	}),
	z.object({
		t: z.literal("refusal"),
		at: z.iso.datetime(),
		pid: z.number().int(),
		tool: z.string(),
		text: z.string(),
		retrying: z.boolean(),
	}),
	z.object({
		t: z.literal("exit"),
		at: z.iso.datetime(),
		pid: z.number().int(),
		code: z.number().int(),
		reason: z.string().optional(),
	}),
]);
export type StubLogEntry = z.infer<typeof stubLogEntrySchema>;

export function appendStubLog(
	path: string | undefined,
	entry: StubLogEntry,
): void {
	if (path === undefined) return;
	appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function readStubLog(path: string): StubLogEntry[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => stubLogEntrySchema.parse(JSON.parse(line)));
}
