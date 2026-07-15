import { procedure } from "virtual:stack-procedure";
import { ApiError } from "@fcalell/plugin-api/error";
import { z } from "@fcalell/plugin-api/schema";
import { serializeStory } from "../../board/markdown.ts";
import { statusSchema, storyIdSchema } from "../../board/schema.ts";
import { writeStory } from "../../board/store.ts";
import { canTransition } from "../../board/transitions.ts";
import { boardSnapshot } from "../../server/services/board.ts";

export const story = {
	move: procedure()
		.input(z.object({ id: storyIdSchema, to: statusSchema }))
		.handler(async ({ input }) => {
			const current = boardSnapshot().stories.find(
				(story) => story.id === input.id,
			);
			if (current === undefined) {
				throw new ApiError("NOT_FOUND", {
					message: `no story with id ${input.id}`,
				});
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
			await writeStory({ path: current.path, frontmatter, body: current.body });
			return {
				...current,
				frontmatter,
				raw: serializeStory(frontmatter, current.body),
			};
		}),
};
