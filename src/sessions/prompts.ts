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

export function questionAnswerPrompt(question: string, answer: string): string {
	return [
		"The user answered your question.",
		`Question: ${question}`,
		`Answer: ${answer}`,
	].join("\n");
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
