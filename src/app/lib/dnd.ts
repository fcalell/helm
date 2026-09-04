import type { Id } from "@thisbeyond/solid-dnd";
import { type Status, statusSchema } from "../../board/schema.ts";

const BAND_SEPARATOR = "::";

// Every cell is one status inside one epic band, so droppable ids are
// namespaced per band; statusFromDropId recovers the status on drop.
export function dropId(status: Status, bandId: string): string {
	return `${bandId}${BAND_SEPARATOR}${status}`;
}

export function statusFromDropId(id: Id): Status | undefined {
	const raw = String(id);
	const candidate = raw.slice(
		raw.lastIndexOf(BAND_SEPARATOR) + BAND_SEPARATOR.length,
	);
	const parsed = statusSchema.safeParse(candidate);
	return parsed.success ? parsed.data : undefined;
}
