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
