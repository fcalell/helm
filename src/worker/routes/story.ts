import { procedure } from "virtual:stack-procedure";
import { ApiError } from "@fcalell/plugin-api/error";
import { z } from "@fcalell/plugin-api/schema";
import {
	presetSchema,
	statusSchema,
	storyIdSchema,
} from "../../board/schema.ts";
import {
	InvalidBoardFileError,
	isENOENT,
	readStoryFile,
	writeStory,
} from "../../board/store.ts";
import { canTransition, clearGateRounds } from "../../board/transitions.ts";
import { boardSnapshot } from "../../server/services/board.ts";
import { dropGateAttempt, requestReady } from "../../server/services/gate.ts";
import { enqueueWrite } from "../../server/write-queue.ts";
import type { GatePhase } from "../../shared/gate.ts";

// A move into Ready that the gate holds carries the attempt's phase, so the
// client can say what the card is waiting on instead of looking inert.
type MoveResult =
	| { gating: false }
	| { gating: true; phase: Exclude<GatePhase, "exhausted"> };

export const story = {
	// Every move but into Ready validates and writes; a move into Ready runs
	// the ready gate: free on a valid recorded verdict, else it enqueues a
	// cold adversary pass and returns `gating: true` with the card still
	// `refining`.
	move: procedure()
		.input(z.object({ id: storyIdSchema, to: statusSchema }))
		.handler(async ({ input }): Promise<MoveResult> => {
			if (input.to === "ready") return requestReady(input.id);
			// A bare status write can never enter `running`: the run lifecycle
			// (worktree, spawn, run entry) is `run.start`'s alone.
			if (input.to === "running") {
				throw new ApiError("ILLEGAL_TRANSITION", {
					status: 409,
					message: "stories enter running through run.start, never a move",
					data: {
						from: "ready",
						to: "running",
						reason: "stories enter running through run.start, never a move",
					},
				});
			}
			// The snapshot trails disk, so use it only to resolve id -> path;
			// validate and write from fresh content read inside the queue.
			const known = boardSnapshot().stories.find(
				(story) => story.id === input.id,
			);
			if (known === undefined) {
				throw new ApiError("NOT_FOUND", {
					message: `no story with id ${input.id}`,
				});
			}

			await enqueueWrite(async () => {
				let current: Awaited<ReturnType<typeof readStoryFile>>;
				try {
					current = await readStoryFile(known.path, known.epicId);
				} catch (error) {
					if (isENOENT(error)) {
						throw new ApiError("NOT_FOUND", {
							message: `no story with id ${input.id}`,
						});
					}
					if (error instanceof InvalidBoardFileError) {
						throw new ApiError("INVALID_FILE", {
							status: 409,
							message: error.message,
						});
					}
					throw error;
				}

				const from = current.frontmatter.status;
				const check = canTransition(from, input.to, {
					brief: current.brief,
					body: current.body,
					gate: current.frontmatter.gate,
				});
				if (!check.ok) {
					throw new ApiError("ILLEGAL_TRANSITION", {
						status: 409,
						message: check.reason,
						data: { from, to: input.to, reason: check.reason },
					});
				}

				// The gate record and its attempt die together, and only once the
				// move is validated: dropping either before would let a rejected
				// move kill a live gate attempt.
				const leavingRefining = from === "refining";
				if (leavingRefining) dropGateAttempt(input.id);
				const frontmatter = {
					...current.frontmatter,
					status: input.to,
					...(leavingRefining && {
						gate: clearGateRounds(current.frontmatter.gate),
					}),
				};
				await writeStory({
					path: current.path,
					frontmatter,
					body: current.body,
				});
			});
			return { gating: false };
		}),
	// Legal at any status: the preset is read once at spawn, so a change during
	// a live run takes effect on the next attempt (mid-run brief-edit
	// semantics).
	setPreset: procedure()
		.input(z.object({ id: storyIdSchema, preset: presetSchema }))
		.handler(async ({ input }) => {
			const known = boardSnapshot().stories.find(
				(story) => story.id === input.id,
			);
			if (known === undefined) {
				throw new ApiError("NOT_FOUND", {
					message: `no story with id ${input.id}`,
				});
			}
			await enqueueWrite(async () => {
				let current: Awaited<ReturnType<typeof readStoryFile>>;
				try {
					current = await readStoryFile(known.path, known.epicId);
				} catch (error) {
					if (isENOENT(error)) {
						throw new ApiError("NOT_FOUND", {
							message: `no story with id ${input.id}`,
						});
					}
					if (error instanceof InvalidBoardFileError) {
						throw new ApiError("INVALID_FILE", {
							status: 409,
							message: error.message,
						});
					}
					throw error;
				}
				await writeStory({
					path: current.path,
					frontmatter: { ...current.frontmatter, preset: input.preset },
					body: current.body,
				});
			});
		}),
};
