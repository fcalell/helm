import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { boardDir, EPIC_DIR_RE, isENOENT, STORY_FILE_RE } from "./store.ts";

const execFileAsync = promisify(execFile);

const EPIC_ADD_RE = /^\.helm\/board\/epics\/(\d{3})-/;
const STORY_ADD_RE = /^\.helm\/board\/epics\/(\d{3})-[^/]+\/(\d{2})-[^/]+\.md$/;

const MAX_EPIC = 999;
const MAX_STORY = 99;

// The next epic ordinal: one above the highest ever used. "Ever used" is the
// live tree plus every path git recorded as added under `.helm/board/epics`, so
// a deleted epic's number is never reused even after the directory is gone.
export async function nextEpicOrdinal(repoPath: string): Promise<number> {
	const live = await liveEpicOrdinals(repoPath);
	const historical = await addedOrdinals(repoPath, (line) => {
		const match = EPIC_ADD_RE.exec(line);
		return match?.[1] !== undefined ? Number(match[1]) : undefined;
	});
	const next = Math.max(0, ...live, ...historical) + 1;
	if (next > MAX_EPIC)
		throw new Error(`epic ordinals exhausted (max ${MAX_EPIC})`);
	return next;
}

// The next story ordinal within an epic, scoped by the epic's ordinal (not its
// slug, so a renamed epic dir still retires its stories' numbers).
export async function nextStoryOrdinal(
	repoPath: string,
	epicId: string,
): Promise<number> {
	const live = await liveStoryOrdinals(repoPath, epicId);
	const historical = await addedOrdinals(repoPath, (line) => {
		const match = STORY_ADD_RE.exec(line);
		if (match?.[1] !== epicId || match[2] === undefined) return undefined;
		return Number(match[2]);
	});
	const next = Math.max(0, ...live, ...historical) + 1;
	if (next > MAX_STORY) {
		throw new Error(
			`story ordinals exhausted in epic ${epicId} (max ${MAX_STORY})`,
		);
	}
	return next;
}

async function liveEpicOrdinals(repoPath: string): Promise<number[]> {
	const entries = await readdirOrEmpty(boardDir(repoPath));
	const out: number[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const ordinal = EPIC_DIR_RE.exec(entry.name)?.[1];
		if (ordinal !== undefined) out.push(Number(ordinal));
	}
	return out;
}

async function liveStoryOrdinals(
	repoPath: string,
	epicId: string,
): Promise<number[]> {
	const dir = boardDir(repoPath);
	const epicDir = (await readdirOrEmpty(dir)).find(
		(entry) =>
			entry.isDirectory() && EPIC_DIR_RE.exec(entry.name)?.[1] === epicId,
	);
	if (epicDir === undefined) return [];
	const out: number[] = [];
	for (const entry of await readdirOrEmpty(join(dir, epicDir.name))) {
		const ordinal = STORY_FILE_RE.exec(entry.name)?.[1];
		if (ordinal !== undefined) out.push(Number(ordinal));
	}
	return out;
}

async function readdirOrEmpty(dir: string): Promise<Dirent[]> {
	try {
		return await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (isENOENT(error)) return [];
		throw error;
	}
}

// Ordinals git ever recorded as added under `.helm/board/epics`. A managed repo
// is always a git repo, so a non-repo throws (silently trusting the live tree
// could reuse a deleted ordinal); an unborn HEAD (nothing committed yet) simply
// contributes no history.
async function addedOrdinals(
	repoPath: string,
	parse: (line: string) => number | undefined,
): Promise<number[]> {
	try {
		await execFileAsync("git", [
			"-C",
			repoPath,
			"rev-parse",
			"--is-inside-work-tree",
		]);
	} catch {
		throw new Error(`ordinal minting: ${repoPath} is not a git repository`);
	}
	try {
		await execFileAsync("git", [
			"-C",
			repoPath,
			"rev-parse",
			"--verify",
			"--quiet",
			"HEAD",
		]);
	} catch {
		return [];
	}
	const { stdout } = await execFileAsync("git", [
		"-C",
		repoPath,
		"log",
		"--diff-filter=A",
		"--no-renames",
		"--name-only",
		"--format=",
		"--",
		".helm/board/epics",
	]);
	const out: number[] = [];
	for (const line of stdout.split("\n")) {
		const ordinal = parse(line.trim());
		if (ordinal !== undefined) out.push(ordinal);
	}
	return out;
}
