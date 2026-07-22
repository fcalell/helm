import { createReadStream } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isENOENT } from "../board/store.ts";
import {
	type PersistedLine,
	persistedLineSchema,
} from "../sessions/persisted.ts";
import { managedRepo } from "./services/board.ts";

// The CLI stores each session's transcript at
// `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, encoding the cwd by
// replacing every non-alphanumeric character with a dash. Chat sessions run in
// the managed repo; run sessions run in worktrees, so the primary lookup can
// miss — an ENOENT falls back to one readdir scan across every project dir
// (session ids are unique).

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
// Keep only the tail: a long session's transcript can be large, and the pane
// only needs recent context on rehydrate.
const MAX_KEPT_LINES = 500;

function encodeCwd(path: string): string {
	return path.replace(/[^a-zA-Z0-9]/g, "-");
}

async function locate(sessionId: string): Promise<string | undefined> {
	const primary = join(
		PROJECTS_DIR,
		encodeCwd(managedRepo().path),
		`${sessionId}.jsonl`,
	);
	if (await exists(primary)) return primary;
	let dirs: string[];
	try {
		dirs = await readdir(PROJECTS_DIR);
	} catch (error) {
		if (isENOENT(error)) return undefined;
		throw error;
	}
	for (const dir of dirs) {
		const candidate = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
		if (await exists(candidate)) return candidate;
	}
	return undefined;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function keep(line: PersistedLine): boolean {
	if (line.type === "system") return true;
	if (line.isSidechain === true || line.isMeta === true) return false;
	if (line.type === "user" && line.isCompactSummary === true) return false;
	return true;
}

// Never throws: a missing transcript is a normal state (the session is live
// only, or its file was pruned).
export async function readTranscript(
	sessionId: string,
): Promise<{ found: boolean; lines: PersistedLine[] }> {
	const path = await locate(sessionId);
	if (path === undefined) return { found: false, lines: [] };
	const kept: PersistedLine[] = [];
	const stream = createReadStream(path, { encoding: "utf8" });
	const rl = createInterface({
		input: stream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	try {
		for await (const raw of rl) {
			if (raw.trim() === "") continue;
			let value: unknown;
			try {
				value = JSON.parse(raw);
			} catch {
				continue;
			}
			const parsed = persistedLineSchema.safeParse(value);
			if (!parsed.success) continue;
			if (!keep(parsed.data)) continue;
			kept.push(parsed.data);
			if (kept.length > MAX_KEPT_LINES) kept.shift();
		}
	} finally {
		rl.close();
		stream.close();
	}
	return { found: true, lines: kept };
}
