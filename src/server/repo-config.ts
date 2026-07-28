import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "@fcalell/plugin-api/error";
import { z } from "@fcalell/plugin-api/schema";
import { isENOENT } from "../board/store.ts";
import { AUTO_ALLOWLIST } from "../sessions/kinds.ts";
import type { ManagedRepo } from "./config.ts";

// The runner joins `--allowedTools` on commas, so a comma would shred the
// pattern.
const patternSchema = z
	.string()
	.min(1)
	.refine((pattern) => !pattern.includes(","), {
		message: "tool patterns must not contain commas",
	});

// One simple command: the CLI checks each component of a compound command
// against the allowlist separately (operators break), and the runner joins
// `--allowedTools` into one comma-separated argument the CLI splits on
// commas (a comma would shred the command's own pattern).
const checkCommandSchema = z
	.string()
	.min(1)
	.refine((cmd) => !/[;,|&]/.test(cmd), {
		message:
			"checkCommand must be one simple command: no shell operators (&&, ||, ;, |, &) and no commas",
	});

// Strict, so a typo in a key fails loudly instead of silently dropping an
// allowlist override. `$comment` is the one free-form key, for hand editors.
const repoConfigFileSchema = z.strictObject({
	$comment: z.string().optional(),
	auto: z
		.union([
			z.strictObject({ extend: z.array(patternSchema) }),
			z.strictObject({ replace: z.array(patternSchema) }),
		])
		.optional(),
	checkCommand: checkCommandSchema.optional(),
});

export const REPO_CONFIG_FILE = ".helm/config.json";

export interface RepoConfig {
	// The Auto preset's effective allowlist: the canonical list unless the
	// repo overrides or extends it.
	tools: readonly string[];
	checkCommand: string | undefined;
}

// The repo's run config, read from the main checkout at spawn. A missing file
// means the canonical allowlist and no check command; an invalid one fails the
// spawn loudly, because a run must never start on a guessed allowlist.
export async function readRepoConfig(repo: ManagedRepo): Promise<RepoConfig> {
	let raw: string;
	try {
		raw = await readFile(join(repo.path, REPO_CONFIG_FILE), "utf8");
	} catch (error) {
		if (isENOENT(error))
			return { tools: AUTO_ALLOWLIST, checkCommand: undefined };
		throw error;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new ApiError("INVALID_FILE", {
			status: 409,
			message: `${REPO_CONFIG_FILE} is not valid JSON: ${detail}`,
		});
	}
	const parsed = repoConfigFileSchema.safeParse(json);
	if (!parsed.success) {
		throw new ApiError("INVALID_FILE", {
			status: 409,
			message: `${REPO_CONFIG_FILE}: ${z.prettifyError(parsed.error)}`,
		});
	}
	const { auto, checkCommand } = parsed.data;
	let tools: readonly string[] = AUTO_ALLOWLIST;
	if (auto !== undefined) {
		tools =
			"replace" in auto ? auto.replace : [...AUTO_ALLOWLIST, ...auto.extend];
	}
	return { tools, checkCommand };
}
