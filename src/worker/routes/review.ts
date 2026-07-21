import { readFile } from "node:fs/promises";
import { procedure } from "virtual:stack-procedure";
import { ApiError } from "@fcalell/plugin-api/error";
import { z } from "@fcalell/plugin-api/schema";
import { storyIdSchema } from "../../board/schema.ts";
import { isENOENT } from "../../board/store.ts";
import { boardSnapshot, managedRepo } from "../../server/services/board.ts";
import {
	approveReview,
	discardReview,
	requestReviewChanges,
} from "../../server/services/review.ts";
import {
	briefFilePath,
	type CheckResult,
	checkFilePath,
	checkResultSchema,
} from "../../server/services/runs.ts";
import {
	diffFiles,
	worktreeExists,
	worktreePath,
} from "../../server/worktrees.ts";

// The check artifact is evidence, not a gate: an absent or malformed file
// reads as `null` rather than failing the review surface.
async function readCheck(storyId: string): Promise<CheckResult | null> {
	let raw: string;
	try {
		raw = await readFile(checkFilePath(storyId), "utf8");
	} catch (error) {
		if (isENOENT(error)) return null;
		throw error;
	}
	try {
		const parsed = checkResultSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export const review = {
	// The Diff tab's payload for a Review card: the spawn-snapshot brief body
	// (live card body when the snapshot is gone), the check evidence, and the
	// per-file diff against main.
	get: procedure()
		.input(z.object({ storyId: storyIdSchema }))
		.handler(async ({ input }) => {
			const story = boardSnapshot().stories.find(
				(each) => each.id === input.storyId,
			);
			if (story === undefined || story.frontmatter.status !== "review") {
				throw new ApiError("NOT_FOUND", {
					message: `no review story with id ${input.storyId}`,
				});
			}
			const repo = managedRepo();
			const worktree = worktreePath(repo, input.storyId);
			if (!(await worktreeExists(worktree))) {
				throw new ApiError("NOT_FOUND", {
					message: `no worktree for story ${input.storyId}`,
				});
			}
			let briefBody = story.body;
			try {
				briefBody = await readFile(briefFilePath(input.storyId), "utf8");
			} catch (error) {
				if (!isENOENT(error)) throw error;
			}
			return {
				briefBody,
				check: await readCheck(input.storyId),
				files: await diffFiles(worktree, repo.mainBranch),
			};
		}),
	// Approve: re-rebase, fast-forward-merge into the managed checkout's main,
	// push best-effort ({ pushed, pushError? }), delete the worktree, branch,
	// and per-story artifacts, card to Done. A git failure before the merge
	// rejects EXIT_FAILED with the card unchanged.
	approve: procedure()
		.input(z.object({ storyId: storyIdSchema }))
		.handler(({ input }) => approveReview(input.storyId)),
	// Request changes: the comments become the next message in the same
	// session and worktree (Fable at high effort); the entry reopens and the
	// card flips to Running on init. Same queued union as run.start.
	requestChanges: procedure()
		.input(
			z.object({
				storyId: storyIdSchema,
				comments: z
					.array(
						z.object({
							criterion: z.string().min(1).optional(),
							text: z.string().min(1),
						}),
					)
					.min(1),
			}),
		)
		.handler(({ input }) =>
			requestReviewChanges(input.storyId, input.comments),
		),
	// Discard: delete the worktree, branch, and artifacts (tolerating what is
	// already gone), keep the brief and run history, card to Ready.
	discard: procedure()
		.input(z.object({ storyId: storyIdSchema }))
		.handler(({ input }) => discardReview(input.storyId)),
};
