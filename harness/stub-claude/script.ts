import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "@fcalell/plugin-api/schema";
import { type StubRole, stubRoleSchema } from "./argv.ts";

export const stubStepSchema = z.discriminatedUnion("t", [
	z.object({ t: z.literal("emit"), event: z.record(z.string(), z.unknown()) }),
	z.object({
		t: z.literal("call"),
		tool: z.string().min(1),
		payload: z.record(z.string(), z.unknown()),
	}),
	z.object({ t: z.literal("exit"), code: z.number().int() }),
]);
export type StubStep = z.infer<typeof stubStepSchema>;

export const stubScriptSchema = z.object({
	role: stubRoleSchema,
	steps: z.array(stubStepSchema),
});
export type StubScript = z.infer<typeof stubScriptSchema>;

export type ClaimResult =
	| { ok: true; name: string; script: StubScript }
	| { ok: false; reason: string };

// An episode never declares more than a handful of spawns per role; the bound
// only stops a runaway loop from scanning forever.
const MAX_ORDINAL = 20;

function isEEXIST(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

export function scriptName(role: StubRole, ordinal: number): string {
	return `${role}-${ordinal}.json`;
}

// Takes the lowest unclaimed ordinal for this role. `open(…, "wx")` is the one
// atomic claim node exposes portably: it fails EEXIST when another spawn holds
// the script, so two overlapping spawns can never read the same one.
export function claimScript(dir: string, role: StubRole): ClaimResult {
	for (let ordinal = 1; ordinal <= MAX_ORDINAL; ordinal += 1) {
		const name = scriptName(role, ordinal);
		const path = join(dir, name);
		if (!existsSync(path)) {
			return { ok: false, reason: `no script ${name} in ${dir}` };
		}
		try {
			closeSync(openSync(`${path}.claim`, "wx"));
		} catch (error) {
			if (isEEXIST(error)) continue;
			return { ok: false, reason: `could not claim ${name}: ${String(error)}` };
		}
		let script: StubScript;
		try {
			script = stubScriptSchema.parse(JSON.parse(readFileSync(path, "utf8")));
		} catch (error) {
			return {
				ok: false,
				reason: `unreadable script ${name}: ${String(error)}`,
			};
		}
		if (script.role !== role) {
			return {
				ok: false,
				reason: `script ${name} declares role ${script.role}, this spawn is ${role}`,
			};
		}
		return { ok: true, name, script };
	}
	return {
		ok: false,
		reason: `every ${role} script up to ordinal ${MAX_ORDINAL} is claimed`,
	};
}
