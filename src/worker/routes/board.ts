import { procedure } from "virtual:stack-procedure";
import { boardSnapshot } from "../../server/services/board.ts";

export const board = {
	get: procedure().handler(() => boardSnapshot()),
};
