import { readFile } from "node:fs/promises";
import { z } from "@fcalell/plugin-api/schema";

const managedRepoSchema = z.object({
	path: z.string().min(1),
	mainBranch: z.string().min(1),
});
export type ManagedRepo = z.infer<typeof managedRepoSchema>;

const helmConfigSchema = z.object({
	repos: z.array(managedRepoSchema).min(1),
});

// Read relative to the process cwd: stack dev and `node .stack/server.ts`
// both run from the Helm repo root.
const CONFIG_FILE = "helm.config.json";

// TODO: reads exactly the first repo; multi-repo boards are a roadmap item.
export async function loadManagedRepo(): Promise<ManagedRepo> {
	let raw: string;
	try {
		raw = await readFile(CONFIG_FILE, "utf8");
	} catch {
		throw new Error(
			`${CONFIG_FILE} not found; copy helm.config.example.json and point it at a target repo`,
		);
	}
	const parsed = helmConfigSchema.safeParse(JSON.parse(raw));
	if (!parsed.success) {
		throw new Error(`${CONFIG_FILE}: ${z.prettifyError(parsed.error)}`);
	}
	if (parsed.data.repos.length > 1) {
		throw new Error(`${CONFIG_FILE}: v1 manages exactly one repo`);
	}
	const repo = parsed.data.repos[0];
	if (repo === undefined) {
		throw new Error(`${CONFIG_FILE}: v1 manages exactly one repo`);
	}
	return repo;
}
