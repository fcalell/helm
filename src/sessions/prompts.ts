import type { BoardToolName } from "./kinds.ts";

export interface ProposalOutcomeItem {
	summary: string;
	outcome: "accept" | "edit" | "reject";
	// Reject reason, or an edit's note / edited-payload JSON.
	detail?: string;
}

// Batched outcomes for one fully resolved proposal; called only when at least
// one item was edited or rejected.
export function proposalOutcomePrompt(
	tool: BoardToolName,
	items: ProposalOutcomeItem[],
): string {
	const lines = items.map((item) => {
		if (item.outcome === "accept") return `- ${item.summary}: accepted`;
		if (item.outcome === "reject") {
			return `- ${item.summary}: rejected: ${item.detail ?? ""}`;
		}
		return `- ${item.summary}: edit requested: ${item.detail ?? ""}`;
	});
	return [
		`The user resolved your ${tool} proposal:`,
		...lines,
		"Accepted items are on the board. Nothing was written for edited or",
		"rejected items: propose revised versions that address each edit and",
		"rejection.",
	].join("\n");
}

// A decision answered from the shaping drawer's checklist: the item is
// already checked off and the answer folded into the agreed notes.
export function decisionResolvedPrompt(
	decision: string,
	answer: string,
): string {
	return [
		"The user resolved an open decision from the Decisions checklist.",
		`Decision: ${decision}`,
		`Answer: ${answer}`,
		"The item is checked off and the answer is in the agreed notes.",
		"Continue shaping; propose epics once no decision is open.",
	].join("\n");
}

// The cold research pass: the single decision plus the shaping thread it
// came from. The session's final text is the finding folded back as the
// resolution.
export function researchPrompt(
	decision: string,
	context: string | undefined,
	threadBody: string,
): string {
	const parts = ["Settle this research decision:", "", `Decision: ${decision}`];
	if (context !== undefined) parts.push(`Context: ${context}`);
	parts.push(
		"",
		"The shaping thread it came from:",
		"",
		"<thread>",
		threadBody.trimEnd(),
		"</thread>",
	);
	return parts.join("\n");
}

// A research finding landed: the checklist write already happened, the same
// one an accepted user resolution makes.
export function researchResolvedPrompt(
	decision: string,
	finding: string,
): string {
	return [
		"A research session resolved an open decision from the Decisions",
		"checklist.",
		`Decision: ${decision}`,
		`Finding: ${finding}`,
		"The item is checked off and the finding is in the agreed notes.",
		"Continue shaping; propose epics once no decision is open.",
	].join("\n");
}

export function questionAnswerPrompt(question: string, answer: string): string {
	return [
		"The user answered your question.",
		`Question: ${question}`,
		`Answer: ${answer}`,
	].join("\n");
}

// The refine seed rides the system prompt (never the transcript): the epic
// body carries the define chat's conclusions (transcripts are not readable),
// and the card body is the brief under construction.
export function refineSeedPrompt(
	cardRaw: string,
	epicBody: string | undefined,
): string {
	const parts = ["You are refining the story card below."];
	if (epicBody !== undefined) {
		parts.push(
			"Its epic's conclusions:",
			"",
			"<epic>",
			epicBody.trimEnd(),
			"</epic>",
		);
	}
	parts.push(
		"The card; its body is the brief under construction:",
		"",
		"<card>",
		cardRaw.trimEnd(),
		"</card>",
	);
	return parts.join("\n");
}

// A fresh session gets the card as its whole history plus the message that
// triggered the resume.
export function reseedPrompt(cardRaw: string, message: string): string {
	return [
		"The earlier chat for this card was lost (its transcript expired).",
		"The card's current content follows; continue from it.",
		"",
		"<card>",
		cardRaw.trimEnd(),
		"</card>",
		"",
		message,
	].join("\n");
}

// The cold adversary pass: the finished brief plus the attempt's override
// register (dismissed flags it must not re-raise). No chat history — the
// cold read is the point.
export function adversaryPrompt(
	briefBody: string,
	overrides: string[],
): string {
	const parts = [
		"Attack the implementation brief below.",
		"",
		"<brief>",
		briefBody.trimEnd(),
		"</brief>",
	];
	if (overrides.length > 0) {
		parts.push(
			"",
			"The user has already accepted these risks; do not re-raise them:",
			...overrides.map((override) => `- ${override}`),
		);
	}
	return parts.join("\n");
}

// Routes a round's flags to the story's refine session.
export function gateFlagsPrompt(
	flags: { title: string; detail: string }[],
): string {
	return [
		"The ready-gate adversary reviewed this brief cold and raised the",
		"flags below. Answer every flag this turn, each with exactly one of:",
		"- a fix: an update_brief proposal for the affected section whose",
		'  "resolves" field names the flag title verbatim;',
		"- a contest: a contest_flag call naming the flag title verbatim,",
		"  carrying your counter-argument.",
		"A flag you leave unanswered is shown to the user as contested with",
		"no counter-argument.",
		"",
		...flags.map((flag) => `- ${flag.title}: ${flag.detail}`),
	].join("\n");
}

// The run's prompt is the brief (card body). The check command must be
// stated here: the config is the orchestrator's, invisible from the
// worktree, and the static registry prompt cannot name it.
export function runPrompt(
	briefBody: string,
	checkCommand: string | undefined,
): string {
	return [
		"Implement the story brief below.",
		"",
		"<brief>",
		briefBody.trimEnd(),
		"</brief>",
		"",
		checkCommand === undefined
			? "No check command is configured for this repo: you cannot self-test. Do not guess one."
			: `The repo's check command is: \`${checkCommand}\`. It is on your allowlist; run it to self-test before finishing.`,
	].join("\n");
}

// Steering after a kill: the resumed model believes the interrupted tool
// call never ran even though its side effects may have partially landed, so
// the message states the interruption.
export function steeringPrompt(message: string): string {
	return [
		"Your previous turn was interrupted mid-run; a tool call in flight may",
		"have partially applied its side effects. Verify before assuming.",
		"",
		message,
	].join("\n");
}
