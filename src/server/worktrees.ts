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

// Converge on branch-plus-worktree from whatever mix exists: the branch is
// the durable artifact, the worktree disposable. Never deletes (002-07).
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
