import { RUN_NOTES_SECTION } from "./schema.ts";

// Strip the trailing `## Run notes` block (from the final such heading up to
// the next `##` heading or end of body) so run-note appends never move the
// hash. Anything appended after the section starts a new block that re-enters
// the hash, so hand edits still stale the gate verdict.
export function stripRunNotes(body: string): string {
	const headingRe = new RegExp(`^## ${RUN_NOTES_SECTION}[ \\t]*$`, "gm");
	let start = -1;
	let afterHeading = -1;
	for (const match of body.matchAll(headingRe)) {
		start = match.index;
		afterHeading = match.index + match[0].length;
	}
	if (start === -1) return body;
	const next = /^##[ \t]/m.exec(body.slice(afterHeading));
	const end = next === null ? body.length : afterHeading + next.index;
	return body.slice(0, start) + body.slice(end);
}

// FNV-1a 64-bit over the brief body, `## Run notes` excluded (run-note
// appends are bookkeeping, not brief edits). Not cryptographic: the hash only
// detects that a brief changed since the gate verdict, and it must run in the
// browser bundle too (the client pre-checks moves), so no node:crypto.
export function briefHash(body: string): string {
	const hashed = stripRunNotes(body);
	let hash = 0xcbf29ce484222325n;
	for (let i = 0; i < hashed.length; i++) {
		hash ^= BigInt(hashed.charCodeAt(i));
		hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
	}
	return hash.toString(16).padStart(16, "0");
}
