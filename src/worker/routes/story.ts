import { procedure } from "virtual:stack-procedure";
import { ApiError } from "@fcalell/plugin-api/error";
import { z } from "@fcalell/plugin-api/schema";
import { statusSchema, storyIdSchema } from "../../board/schema.ts";
import {
	InvalidBoardFileError,
	isENOENT,
	readStoryFile,
	writeStory,
} from "../../board/store.ts";
import { canTransition } from "../../board/transitions.ts";
import { boardSnapshot } from "../../server/services/board.ts";
import { requestReady } from "../../server/services/gate.ts";
import { enqueueWrite } from "../../server/write-queue.ts";

export const story = {
	// Every move but into Ready validates and writes; a move into Ready runs
	// the ready gate: free on a valid recorded verdict, else it enqueues a
	// cold adversary pass and returns `gating: true` with the card still
	// `refining`.
	move: procedure()
		.input(z.object({ id: storyIdSchema, to: statusSchema }))
		.handler(async ({ input }): Promise<{ gating: boolean }> => {
			if (input.to === "ready") return requestReady(input.id);
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

				const frontmatter = { ...current.frontmatter, status: input.to };
				await writeStory({
					path: current.path,
					frontmatter,
					body: current.body,
				});
			});
			return { gating: false };
		}),
};
