import { rm } from "node:fs/promises";
import { ApiError } from "@fcalell/plugin-api/error";
import { defineService } from "@fcalell/plugin-node/server";
import type { StoryFrontmatter } from "../../board/schema.ts";
import { readStoryFile, type Story, writeStory } from "../../board/store.ts";
import {
	type ReviewComment,
	requestChangesPrompt,
} from "../../sessions/prompts.ts";
import type { ManagedRepo } from "../config.ts";
import {
	currentBranch,
	deleteBranch,
	hasUpstream,
	mergeFastForward,
	push,
	rebaseOntoMain,
	removeWorktree,
	worktreeExists,
	worktreePath,
} from "../worktrees.ts";
import { enqueueWrite } from "../write-queue.ts";
import { managedRepo } from "./board.ts";
import {
	assertNoActiveRun,
	briefFilePath,
	checkFilePath,
	dispatchResume,
	errorText,
	findStory,
	illegalTransition,
	pidFilePath,
	type ResumeSpec,
	type RunDispatch,
	readStoryOrApiError,
	settingsFilePath,
} from "./runs.ts";

let log: { error(m: string): void } | undefined;

// A git step's failure during an interactive exit: the card is left
// unchanged and the message reaches the user as a toast, unlike the
// unattended close path that parks Blocked.
function exitFailed(error: unknown): never {
	throw new ApiError("EXIT_FAILED", {
		status: 409,
		message: errorText(error),
	});
}

// Every exit's precondition, on a fresh read: the story is in review with no
// live or queued run.
async function reviewStory(
	storyId: string,
	to: "done" | "ready" | "running",
): Promise<{ story: Story; repo: ManagedRepo }> {
	const known = findStory(storyId);
	const story = await readStoryOrApiError(known.path, known.epicId, storyId);
	const from = story.frontmatter.status;
	if (from !== "review") {
		illegalTransition(from, to, `only a review story can exit to ${to}`);
	}
	assertNoActiveRun(storyId);
	return { story, repo: managedRepo() };
}

// The exits' artifact sweep: the per-story files beside the worktrees.
async function removeArtifacts(storyId: string): Promise<void> {
	for (const path of [
		briefFilePath(storyId),
		checkFilePath(storyId),
		settingsFilePath(storyId),
		pidFilePath(storyId),
	]) {
		try {
			await rm(path, { force: true });
		} catch (error) {
			log?.error(
				`review ${storyId}: artifact delete failed: ${errorText(error)}`,
			);
		}
	}
}

async function writeStatus(
	story: Story,
	status: StoryFrontmatter["status"],
): Promise<void> {
	await enqueueWrite(async () => {
		const current = await readStoryFile(story.path, story.epicId);
		await writeStory({
			path: current.path,
			frontmatter: { ...current.frontmatter, status },
			body: current.body,
		});
	});
}

export interface ApproveResult {
	pushed: boolean;
	pushError?: string;
}

// Approve: re-rebase (main may have moved since review opened), fast-forward
// the managed checkout's main, push best-effort, delete the worktree, branch,
// and artifacts. The merge is the point of no return: everything after it
// completes the exit whatever fails.
export async function approveReview(storyId: string): Promise<ApproveResult> {
	const { story, repo } = await reviewStory(storyId, "done");
	const branch = story.frontmatter.branch;
	const worktree = worktreePath(repo, storyId);
	if (branch === undefined || !(await worktreeExists(worktree))) {
		throw new ApiError("NOT_FOUND", {
			message: `no worktree for story ${storyId}`,
		});
	}
	try {
		await rebaseOntoMain(worktree, repo.mainBranch);
	} catch (error) {
		exitFailed(error);
	}
	const checkedOut = await currentBranch(repo.path).catch(exitFailed);
	if (checkedOut !== repo.mainBranch) {
		exitFailed(
			new Error(
				`managed checkout is on ${checkedOut || "a detached HEAD"}, not ${repo.mainBranch}; check it out before approving`,
			),
		);
	}
	try {
		await mergeFastForward(repo.path, branch);
	} catch (error) {
		exitFailed(error);
	}

	let pushed = false;
	let pushError: string | undefined;
	if (await hasUpstream(repo.path, repo.mainBranch)) {
		try {
			await push(repo.path);
			pushed = true;
		} catch (error) {
			pushError = errorText(error);
			log?.error(`review ${storyId}: push failed: ${pushError}`);
		}
	}

	try {
		await removeWorktree(repo.path, worktree);
	} catch (error) {
		log?.error(
			`review ${storyId}: worktree remove failed: ${errorText(error)}`,
		);
	}
	try {
		await deleteBranch(repo.path, branch);
	} catch (error) {
		log?.error(`review ${storyId}: branch delete failed: ${errorText(error)}`);
	}
	await removeArtifacts(storyId);

	await writeStatus(story, "done");
	return { pushed, ...(pushError !== undefined && { pushError }) };
}

// Discard: delete whatever exists of the attempt (worktree, unmerged branch,
// artifacts) and land the card Ready. The closed run entry stays untouched:
// the run history is the point, and the still-valid gate makes the story
// immediately runnable again.
export async function discardReview(storyId: string): Promise<void> {
	const { story, repo } = await reviewStory(storyId, "ready");
	const worktree = worktreePath(repo, storyId);
	try {
		if (await worktreeExists(worktree)) {
			await removeWorktree(repo.path, worktree);
		}
		if (story.frontmatter.branch !== undefined) {
			await deleteBranch(repo.path, story.frontmatter.branch, { force: true });
		}
	} catch (error) {
		exitFailed(error);
	}
	await removeArtifacts(storyId);
	await writeStatus(story, "ready");
}

// Request changes: the comments become the next message in the same session
// and worktree, routed to Fable at high effort (a user-comment payload is the
// escalation case, session-kinds.md §Model per kind). The entry reopens
// (outcome, error, and stat cleared) and the close path re-runs
// rebase/check/stat on the follow-up's finish, summing usage onto the entry.
export async function requestReviewChanges(
	storyId: string,
	comments: ReviewComment[],
): Promise<RunDispatch> {
	await reviewStory(storyId, "running");
	return dispatchResume(storyId, requestChangesSpec(comments));
}

function requestChangesSpec(comments: ReviewComment[]): ResumeSpec {
	const reopenable = (current: Story) => {
		if (current.frontmatter.status !== "review") return undefined;
		const last = current.frontmatter.runs.at(-1);
		// A blocked entry has nothing to resume into review.
		if (last === undefined || last.outcome !== "review") return undefined;
		return last;
	};
	return {
		precheck: (current) => {
			const from = current.frontmatter.status;
			const entry = reopenable(current);
			if (entry === undefined) {
				illegalTransition(
					from,
					"running",
					"only a review story whose last run closed in review can take change requests",
				);
			}
			return { session: entry.session, prompt: requestChangesPrompt(comments) };
		},
		recheck: (fresh) => {
			if (reopenable(fresh) === undefined) return undefined;
			const runs = [...fresh.frontmatter.runs];
			const last = runs.at(-1);
			if (last === undefined) return undefined;
			const { outcome: _o, error: _e, stat: _s, ...reopened } = last;
			runs[runs.length - 1] = reopened;
			return { ...fresh.frontmatter, status: "running", runs };
		},
		abort: {
			from: "review",
			reason: "story left review during the exit; the move wins",
		},
		model: "fable",
		effort: "high",
	};
}

export default defineService({
	name: "review",
	start: (ctx) => {
		log = ctx.log;
		return () => {
			log = undefined;
		};
	},
});
