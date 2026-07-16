import { readFile } from "node:fs/promises";
import { z } from "@fcalell/plugin-api/schema";
import { isENOENT } from "../board/store.ts";

const managedRepoSchema = z.object({
	path: z.string().min(1),
	mainBranch: z.string().min(1),
});
export type ManagedRepo = z.infer<typeof managedRepoSchema>;

const helmConfigSchema = z.object({
	repos: z.array(managedRepoSchema),
});

// Read relative to the process cwd: stack dev and `node .stack/server.ts`
// both run from the Helm repo root.
const CONFIG_FILE = "helm.config.json";

// TODO: reads exactly the first repo; multi-repo boards are a roadmap item.
export async function loadManagedRepo(): Promise<ManagedRepo> {
	let raw: string;
	try {
		raw = await readFile(CONFIG_FILE, "utf8");
	} catch (error) {
		if (isENOENT(error)) {
			throw new Error(
				`${CONFIG_FILE} not found; copy helm.config.example.json and point it at a target repo`,
			);
		}
		throw error;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`${CONFIG_FILE} is not valid JSON: ${detail}`);
	}
	const parsed = helmConfigSchema.safeParse(json);
	if (!parsed.success) {
		throw new Error(`${CONFIG_FILE}: ${z.prettifyError(parsed.error)}`);
	}
	const repo = parsed.data.repos[0];
	if (repo === undefined || parsed.data.repos.length !== 1) {
		throw new Error(`${CONFIG_FILE}: v1 manages exactly one repo`);
	}
	return repo;
}
