import { BRIEF_SECTIONS, type Brief, type Status } from "./schema.ts";

export const LEGAL_TRANSITIONS = {
	backlog: ["refining", "blocked"],
	refining: ["backlog", "ready", "blocked"],
	ready: ["refining", "running", "blocked"],
	running: ["needs-input", "review", "blocked"],
	"needs-input": ["running", "blocked"],
	review: ["done", "running", "ready", "blocked"],
	done: [],
	blocked: ["backlog", "refining", "ready"],
} as const satisfies Record<Status, readonly Status[]>;

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function checkReadyGate(brief: Brief): TransitionCheck {
	const missing = BRIEF_SECTIONS.filter(
		(section) =>
			section !== "Open questions" && !brief.sections[section]?.trim(),
	);
	if (missing.length > 0) {
		return {
			ok: false,
			reason: `brief sections not set: ${missing.join(", ")}`,
		};
	}
	if (brief.criteria.length === 0) {
		return { ok: false, reason: "no acceptance criteria yet" };
	}
	const open = brief.openQuestions.filter((q) => !q.checked).length;
	if (open > 0) {
		return { ok: false, reason: `${open} open question(s) unresolved` };
	}
	return { ok: true };
}

export function canTransition(
	from: Status,
	to: Status,
	brief: Brief,
): TransitionCheck {
	const targets: readonly Status[] = LEGAL_TRANSITIONS[from];
	if (!targets.includes(to)) {
		return { ok: false, reason: `a ${from} story cannot move to ${to}` };
	}
	if (to === "ready" && from !== "review") return checkReadyGate(brief);
	return { ok: true };
}
