import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "@fcalell/plugin-api/error";
import { z } from "@fcalell/plugin-api/schema";
import { isENOENT } from "../board/store.ts";
import { AUTO_ALLOWLIST } from "../sessions/kinds.ts";
import type { ManagedRepo } from "./config.ts";

// The runner joins `--allowedTools` on commas, so a comma would shred the
// pattern (the same constraint checkCommand carries).
const patternSchema = z
	.string()
	.min(1)
	.refine((pattern) => !pattern.includes(","), {
		message: "tool patterns must not contain commas",
	});

const permissionsFileSchema = z.strictObject({
	auto: z
		.union([
			z.strictObject({ extend: z.array(patternSchema) }),
			z.strictObject({ replace: z.array(patternSchema) }),
		])
		.optional(),
});

export const PERMISSIONS_FILE = ".helm/permissions.json";

// The Auto preset's effective allowlist: the canonical list unless the repo
// overrides or extends it. Read from the main checkout at spawn; an invalid
// file fails the spawn loudly, because a run must never start on a guessed
// allowlist.
export async function autoAllowlist(
	repo: ManagedRepo,
): Promise<readonly string[]> {
	let raw: string;
	try {
		raw = await readFile(join(repo.path, PERMISSIONS_FILE), "utf8");
	} catch (error) {
		if (isENOENT(error)) return AUTO_ALLOWLIST;
		throw error;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new ApiError("INVALID_FILE", {
			status: 409,
			message: `${PERMISSIONS_FILE} is not valid JSON: ${detail}`,
		});
	}
	const parsed = permissionsFileSchema.safeParse(json);
	if (!parsed.success) {
		throw new ApiError("INVALID_FILE", {
			status: 409,
			message: `${PERMISSIONS_FILE}: ${z.prettifyError(parsed.error)}`,
		});
	}
	const auto = parsed.data.auto;
	if (auto === undefined) return AUTO_ALLOWLIST;
	if ("replace" in auto) return auto.replace;
	return [...AUTO_ALLOWLIST, ...auto.extend];
}
