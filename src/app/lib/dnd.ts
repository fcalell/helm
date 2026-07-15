import type { Id } from "@thisbeyond/solid-dnd";
import { type Status, statusSchema } from "../../board/schema.ts";

const LANE_SEPARATOR = "::";

// Epic-lane view renders one column per status per lane, so droppable ids are
// namespaced per lane; statusFromDropId recovers the status on drop.
export function dropId(status: Status, laneId?: string): string {
	return laneId ? `${laneId}${LANE_SEPARATOR}${status}` : status;
}

export function statusFromDropId(id: Id): Status | undefined {
	const raw = String(id);
	const candidate = raw.includes(LANE_SEPARATOR)
		? raw.slice(raw.lastIndexOf(LANE_SEPARATOR) + LANE_SEPARATOR.length)
		: raw;
	const parsed = statusSchema.safeParse(candidate);
	return parsed.success ? parsed.data : undefined;
}
