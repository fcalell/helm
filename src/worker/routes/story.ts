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

// Serialize read-validate-write so concurrent moves can't validate against
// each other's stale disk state. Single-repo for v1.
// TODO: key by repo when multi-repo boards land (roadmap).
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const result = writeQueue.then(task);
	writeQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

export const story = {
	move: procedure()
		.input(z.object({ id: storyIdSchema, to: statusSchema }))
		.handler(async ({ input }) => {
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
				const check = canTransition(from, input.to, current.brief);
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
		}),
};
