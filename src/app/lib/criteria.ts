// UI heuristic flagging unmeasurable acceptance-criteria phrasing.

const VAGUE_PHRASES = [
	"works? well",
	"works? (?:properly|correctly|fine|great)",
	"good",
	"nice(?:ly)?",
	"fast(?:er)?",
	"quick(?:ly)?",
	"slow(?:er)?",
	"easy",
	"easily",
	"simple",
	"clean(?:ly)?",
	"smooth(?:ly)?",
	"seamless(?:ly)?",
	"robust(?:ly)?",
	"reliab(?:le|ly)",
	"properly",
	"graceful(?:ly)?",
	"efficient(?:ly)?",
	"performant",
	"user.?friendly",
	"intuitive(?:ly)?",
	"better",
	"improved?",
	"reasonab(?:le|ly)",
	"appropriate(?:ly)?",
	"as expected",
	"makes? sense",
];

const VAGUE_RE = new RegExp(`\\b(?:${VAGUE_PHRASES.join("|")})\\b`, "i");

// The vague phrase when the criterion reads unmeasurable; undefined otherwise.
export function weakCriterion(text: string): string | undefined {
	return VAGUE_RE.exec(text)?.[0];
}
