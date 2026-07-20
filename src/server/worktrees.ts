import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ManagedRepo } from "./config.ts";

const execFileAsync = promisify(execFile);

export const SAFETY_COMMIT_MESSAGE = "chore(helm): commit run leftovers";

async function git(cwd: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
		return stdout;
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr?.trim();
		throw new Error(
			`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
		);
	}
}

export function worktreesDir(repo: ManagedRepo): string {
	return join(homedir(), ".helm", "worktrees", basename(repo.path));
}

export function worktreePath(repo: ManagedRepo, storyId: string): string {
	return join(worktreesDir(repo), storyId);
}

async function branchExists(
	repoPath: string,
	branch: string,
): Promise<boolean> {
	try {
		await execFileAsync("git", [
			"-C",
			repoPath,
			"show-ref",
			"--verify",
			"--quiet",
			`refs/heads/${branch}`,
		]);
		return true;
	} catch {
		return false;
	}
}

async function isDirty(worktree: string): Promise<boolean> {
	return (await git(worktree, ["status", "--porcelain"])).trim() !== "";
}

export async function worktreeExists(path: string): Promise<boolean> {
	try {
		await git(path, ["rev-parse", "--is-inside-work-tree"]);
		return true;
	} catch {
		return false;
	}
}

// Commit whatever a run left behind, `.helm/` excluded, as an
// orchestrator-identifiable bookkeeping commit: `--no-verify --no-gpg-sign`
// so the managed repo's pre-commit hooks never fail on half-finished
// leftovers and a gpg pinentry never hangs a headless flip. Throws on git
// failure; every caller applies the never-proceed-as-clean rule.
export async function safetyCommit(worktree: string): Promise<boolean> {
	if (!(await isDirty(worktree))) return false;
	await git(worktree, ["add", "-A", "--", ".", ":(exclude).helm"]);
	try {
		await execFileAsync("git", ["-C", worktree, "diff", "--cached", "--quiet"]);
		// Nothing staged: the dirt is `.helm/`-only, which never rides a
		// safety commit.
		return false;
	} catch {
		// Non-zero exit: staged changes exist.
	}
	await git(worktree, [
		"commit",
		"--no-verify",
		"--no-gpg-sign",
		"-m",
		SAFETY_COMMIT_MESSAGE,
	]);
	return true;
}

// Committed `.helm/` changes on the story branch: the one path the deny
// rules and the safety-commit exclusion cannot close (the allowlisted git
// wildcards cannot express path constraints).
export async function helmDiffPaths(
	worktree: string,
	mainBranch: string,
	branch: string,
): Promise<string[]> {
	const out = await git(worktree, [
		"diff",
		"--name-only",
		`${mainBranch}...${branch}`,
		"--",
		".helm/",
	]);
	return out.split("\n").filter((line) => line.trim() !== "");
}

// Rebase the worktree's branch onto main; an up-to-date branch is a no-op.
// On any failure the rebase is aborted (best effort) so the worktree is left
// on the pre-rebase tip with no rebase in progress, and the thrown error
// names the rebase with the stderr tail.
export async function rebaseOntoMain(
	worktree: string,
	mainBranch: string,
): Promise<void> {
	try {
		await execFileAsync("git", ["-C", worktree, "rebase", mainBranch]);
	} catch (error) {
		try {
			await execFileAsync("git", ["-C", worktree, "rebase", "--abort"]);
		} catch {
			// Some failures (a dirty tree, an unknown ref) never started a rebase.
		}
		const failure = error as { stderr?: string; stdout?: string };
		// Advice lines ("hint: …") would crowd the CONFLICT line out of the tail.
		const strip = (text: string | undefined): string =>
			(text ?? "")
				.split("\n")
				.filter((line) => !line.startsWith("hint:"))
				.join("\n")
				.trim();
		const detail = (
			strip(failure.stderr) ||
			strip(failure.stdout) ||
			String(error)
		).slice(-240);
		throw new Error(`rebase on ${mainBranch} failed: ${detail}`);
	}
}

// "N files +A -D" from `git diff --shortstat main...HEAD`; an empty diff
// (nothing changed against main) reads "0 files +0 -0".
export async function diffStat(
	worktree: string,
	mainBranch: string,
): Promise<string> {
	const out = await git(worktree, [
		"diff",
		"--shortstat",
		`${mainBranch}...HEAD`,
	]);
	const files = /(\d+) files? changed/.exec(out)?.[1] ?? "0";
	const additions = /(\d+) insertions?\(\+\)/.exec(out)?.[1] ?? "0";
	const deletions = /(\d+) deletions?\(-\)/.exec(out)?.[1] ?? "0";
	return `${files} files +${additions} -${deletions}`;
}

export interface DiffLine {
	kind: "context" | "add" | "del";
	oldLine?: number;
	newLine?: number;
	text: string;
}

export interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

export interface DiffFile {
	path: string;
	oldPath?: string;
	status: "added" | "modified" | "deleted" | "renamed";
	binary: boolean;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

export async function diffFiles(
	worktree: string,
	mainBranch: string,
): Promise<DiffFile[]> {
	return parseDiff(await git(worktree, ["diff", "-M", `${mainBranch}...HEAD`]));
}

const FILE_HEADER_RE = /^diff --git "?a\/(.*?)"? "?b\/(.*?)"?$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;
// Metadata lines between a file header and its first hunk.
const FILE_META_RE =
	/^(index |old mode |new mode |mode |similarity index |dissimilarity index |copy from |copy to |--- |\+\+\+ )/;

// Tolerant unified-diff parsing: a line the parser cannot place drops the
// file to a binary-style stub (`binary: true`, no hunks) instead of throwing.
export function parseDiff(text: string): DiffFile[] {
	const files: DiffFile[] = [];
	let file: DiffFile | undefined;
	let oldNo = 0;
	let newNo = 0;
	let inHunk = false;

	const stub = (): void => {
		if (file === undefined) return;
		file.binary = true;
		file.additions = 0;
		file.deletions = 0;
		file.hunks = [];
		inHunk = false;
	};

	// Drop the trailing empty string of the final newline: inside a hunk it
	// would otherwise read as one stray empty context line.
	const raw = text.split("\n");
	if (raw[raw.length - 1] === "") raw.pop();

	for (const line of raw) {
		const header = FILE_HEADER_RE.exec(line);
		if (header !== null) {
			file = {
				path: header[2] ?? "",
				status: "modified",
				binary: false,
				additions: 0,
				deletions: 0,
				hunks: [],
			};
			files.push(file);
			inHunk = false;
			continue;
		}
		if (file === undefined || file.binary) continue;
		if (line.startsWith("new file mode ")) {
			file.status = "added";
			continue;
		}
		if (line.startsWith("deleted file mode ")) {
			file.status = "deleted";
			continue;
		}
		if (line.startsWith("rename from ")) {
			file.status = "renamed";
			file.oldPath = line.slice("rename from ".length);
			continue;
		}
		if (line.startsWith("rename to ")) {
			file.path = line.slice("rename to ".length);
			continue;
		}
		if (line.startsWith("Binary files ") || line === "GIT binary patch") {
			file.binary = true;
			continue;
		}
		const hunk = HUNK_HEADER_RE.exec(line);
		if (hunk !== null) {
			oldNo = Number(hunk[1]);
			newNo = Number(hunk[2]);
			file.hunks.push({ header: line, lines: [] });
			inHunk = true;
			continue;
		}
		if (!inHunk) {
			if (!FILE_META_RE.test(line)) stub();
			continue;
		}
		const lines = file.hunks[file.hunks.length - 1]?.lines;
		if (lines === undefined) continue;
		if (line.startsWith("+")) {
			lines.push({ kind: "add", newLine: newNo++, text: line.slice(1) });
			file.additions++;
		} else if (line.startsWith("-")) {
			lines.push({ kind: "del", oldLine: oldNo++, text: line.slice(1) });
			file.deletions++;
		} else if (line.startsWith(" ") || line === "") {
			lines.push({
				kind: "context",
				oldLine: oldNo++,
				newLine: newNo++,
				text: line.slice(1),
			});
		} else if (line !== "\\ No newline at end of file") {
			stub();
		}
	}
	return files;
}

// Converge on branch-plus-worktree from whatever mix exists: the branch is
// the durable artifact, the worktree disposable.
export async function ensureWorktree(input: {
	repo: ManagedRepo;
	storyId: string;
	branch: string;
}): Promise<{ path: string }> {
	const { repo, storyId, branch } = input;
	const path = worktreePath(repo, storyId);
	// Clear stale registrations left by an out-of-band directory delete.
	await git(repo.path, ["worktree", "prune"]);

	if (!(await worktreeExists(path))) {
		await mkdir(worktreesDir(repo), { recursive: true });
		const hasBranch = await branchExists(repo.path, branch);
		await git(repo.path, [
			"worktree",
			"add",
			path,
			...(hasBranch ? [branch] : ["-b", branch, repo.mainBranch]),
		]);
		// Non-cone sparse checkout: everything but board state, so the run
		// still loads Helm's rules while `.helm/board/` never enters the
		// branch.
		await git(path, [
			"sparse-checkout",
			"set",
			"--no-cone",
			"/*",
			"!/.helm/board/",
		]);
		return { path };
	}

	// Reuse: safety-commit leftovers first, on the HEAD where that work
	// actually happened, then converge onto the frontmatter branch.
	await safetyCommit(path);
	const head = (await git(path, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
	if (head !== branch) {
		if (await branchExists(repo.path, branch)) {
			await git(path, ["checkout", branch]);
		} else {
			await git(path, ["checkout", "-b", branch, repo.mainBranch]);
		}
	}
	return { path };
}
