import { Document, isMap, isSeq } from "yaml";
import {
	BRIEF_SECTIONS,
	type Brief,
	type BriefSection,
	CHECKLIST_RE,
	type ChecklistItem,
	type CriterionItem,
	type DecisionItem,
	type DecisionSettler,
	type EpicFrontmatter,
	type Gate,
	RUN_NOTES_SECTION,
	type ShapingFrontmatter,
	type StoryFrontmatter,
	type VerificationMode,
} from "./schema.ts";

export interface SplitFile {
	head: string;
	body: string;
}

const OPEN_FENCE_RE = /^---[ \t]*\r?\n/;
// A closing `---` line, at the start of the head (empty frontmatter), after a
// newline, or at EOF without a trailing newline.
const CLOSE_FENCE_RE = /(^|\r?\n)---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(raw: string): SplitFile | undefined {
	const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
	const open = OPEN_FENCE_RE.exec(text);
	if (open === null) return undefined;
	const rest = text.slice(open[0].length);
	const close = CLOSE_FENCE_RE.exec(rest);
	if (close === null) return undefined;
	const lead = close[1] ?? "";
	return {
		head: rest.slice(0, close.index + lead.length),
		body: rest.slice(close.index + close[0].length),
	};
}

const HEADING_RE = /^(#{1,2})\s+(.*)$/;

// A line that continues the checklist item above it: indented and non-blank.
// A blank line, an unindented line, a heading, or another checklist item ends
// the item instead.
const CONTINUATION_RE = /^\s+\S/;

// A scanned checklist item: its mark, its text with continuation lines folded
// in, and the index of the line carrying the `[ ]` marker.
interface ScannedItem {
	mark: string;
	text: string;
	line: number;
}

// The one place `CHECKLIST_RE` runs. Wrapping is the norm in a board file (the
// repo wraps prose at 100 columns), so an item's text is only complete once
// its continuation lines are folded in: the reader, the mode tag's `$` anchor,
// and every match-by-text mutator all depend on this.
function scanChecklist(
	lines: readonly string[],
	start = 0,
	end = lines.length,
): ScannedItem[] {
	const items: ScannedItem[] = [];
	for (let i = start; i < end; i++) {
		const match = CHECKLIST_RE.exec(lines[i] ?? "");
		if (match === null) continue;
		const parts = [match[2] ?? ""];
		let next = i + 1;
		while (next < end) {
			const line = lines[next] ?? "";
			if (!CONTINUATION_RE.test(line) || CHECKLIST_RE.test(line)) break;
			parts.push(line.trim());
			next += 1;
		}
		items.push({
			mark: match[1] ?? " ",
			text: parts.join(" ").trim(),
			line: i,
		});
		i = next - 1;
	}
	return items;
}

// The line range of a `## <name>` section, its heading excluded; the section
// ends at the next heading of either level.
function sectionRange(
	lines: readonly string[],
	name: string,
): { start: number; end: number } | undefined {
	let start: number | undefined;
	for (let i = 0; i < lines.length; i++) {
		const heading = HEADING_RE.exec(lines[i] ?? "");
		if (heading === null) continue;
		if (start !== undefined) return { start, end: i };
		if (heading[1] === "##" && heading[2]?.trim() === name) start = i + 1;
	}
	return start === undefined ? undefined : { start, end: lines.length };
}

export function parseChecklist(text: string): ChecklistItem[] {
	return scanChecklist(text.split("\n")).map((item) => ({
		text: item.text,
		checked: item.mark !== " ",
	}));
}

// A criterion's trailing verification-mode tag; `text` holds the tag-stripped
// label, so grading, ReviewComment.criterion, and display all match one
// canonical string. Untagged criteria carry no mode (only the gate enforces).
const CRITERION_MODE_RE = /\s*\((test|command|file|live)\)$/;

export function parseCriteria(sectionText: string): CriterionItem[] {
	return parseChecklist(sectionText).map((item) => {
		const tag = CRITERION_MODE_RE.exec(item.text);
		const mode = tag?.[1] as VerificationMode | undefined;
		return {
			text: item.text.replace(CRITERION_MODE_RE, "").trim(),
			checked: item.checked,
			...(mode !== undefined && { mode }),
		};
	});
}

export function parseBrief(body: string): Brief {
	let title = "";
	const sections: Record<string, string> = {};
	let heading: string | undefined;
	let buffer: string[] = [];
	const flush = (): void => {
		if (heading !== undefined) sections[heading] = buffer.join("\n").trim();
		buffer = [];
	};
	for (const line of body.split("\n")) {
		const match = HEADING_RE.exec(line);
		const level = match?.[1];
		const text = match?.[2]?.trim();
		if (level === undefined || text === undefined) {
			buffer.push(line);
			continue;
		}
		flush();
		if (level === "#") {
			heading = undefined;
			title = text;
		} else {
			heading = text;
		}
	}
	flush();
	return {
		title,
		sections,
		criteria: parseCriteria(sections["Acceptance criteria"] ?? ""),
		openQuestions: parseChecklist(sections["Open questions"] ?? ""),
	};
}

// `lineWidth: 0` disables wrapping, so a flow container holding a list renders
// as one unbounded line: any list under `gate` forces the whole container to
// block style, and only each round's flags stay flow maps, one per line.
function styleGate(node: unknown): void {
	if (!isMap(node)) return;
	const rounds = node.get("rounds", true);
	const overrides = node.get("overrides", true);
	const listed =
		(isSeq(rounds) && rounds.items.length > 0) ||
		(isSeq(overrides) && overrides.items.length > 0);
	if (!listed) {
		node.flow = true;
		return;
	}
	if (!isSeq(rounds)) return;
	for (const round of rounds.items) {
		if (!isMap(round)) continue;
		const flags = round.get("flags", true);
		if (!isSeq(flags)) continue;
		for (const flag of flags.items) {
			if (isMap(flag)) flag.flow = true;
		}
	}
}

// The `gate` block as it is written: an empty `rounds` key is omitted, and a
// block holding no verdict, no rounds and no overrides is dropped entirely so
// a cleared record leaves no residue.
function gateBlock(gate: Gate): Record<string, unknown> | undefined {
	if (
		gate.passed === undefined &&
		gate.rounds.length === 0 &&
		gate.overrides.length === 0
	) {
		return undefined;
	}
	return {
		...(gate.passed !== undefined && { passed: gate.passed }),
		...(gate.brief !== undefined && { brief: gate.brief }),
		overrides: gate.overrides,
		...(gate.rounds.length > 0 && { rounds: gate.rounds }),
	};
}

function stringifyFrontmatter(ordered: Record<string, unknown>): string {
	const doc = new Document(ordered);
	const sessions = doc.get("sessions", true);
	if (isMap(sessions)) sessions.flow = true;
	styleGate(doc.get("gate", true));
	const depends = doc.get("depends", true);
	if (isSeq(depends)) depends.flow = true;
	const runs = doc.get("runs", true);
	if (isSeq(runs)) {
		for (const run of runs.items) {
			if (isMap(run)) run.flow = true;
		}
	}
	// lineWidth 0 disables the yaml default of wrapping flow maps at 80 cols.
	return doc.toString({ lineWidth: 0 });
}

export function serializeStory(
	frontmatter: StoryFrontmatter,
	body: string,
): string {
	const { id, status, depends, branch, preset, gate, sessions, runs } =
		frontmatter;
	const ordered: Record<string, unknown> = { id, status, depends };
	if (branch !== undefined) ordered.branch = branch;
	if (preset !== undefined) ordered.preset = preset;
	const block = gate === undefined ? undefined : gateBlock(gate);
	if (block !== undefined) ordered.gate = block;
	ordered.sessions = sessions;
	ordered.runs = runs;
	return `---\n${stringifyFrontmatter(ordered)}---\n${body}`;
}

export function serializeEpic(
	frontmatter: EpicFrontmatter,
	body: string,
): string {
	return `---\n${stringifyFrontmatter({ sessions: frontmatter.sessions })}---\n${body}`;
}

export function serializeShaping(
	frontmatter: ShapingFrontmatter,
	body: string,
): string {
	return `---\n${stringifyFrontmatter({ sessions: frontmatter.sessions })}---\n${body}`;
}

// The two shaping sections: notes accumulate resolution appends, decisions
// are the checklist the breakdown waits on.
export const SHAPING_NOTES = "Agreed notes";
export const SHAPING_DECISIONS = "Decisions";

export function buildShapingBody(title: string, goal: string): string {
	return `# ${title}\n\n## ${SHAPING_NOTES}\n\n${goal.trim()}\n\n## ${SHAPING_DECISIONS}\n`;
}

// A research decision carries its tag as a trailing marker; untagged items
// are human decisions (the default settler).
const DECISION_TAG_RE = /\s*\((research)\)$/;

// The comparison key for decision text: tag stripped, internal whitespace
// collapsed, trimmed. Duplicate raises and resolutions match on this, not on
// byte-exact text.
export function normalizeDecision(text: string): string {
	return text.replace(DECISION_TAG_RE, "").replace(/\s+/g, " ").trim();
}

export function parseDecisions(body: string): DecisionItem[] {
	const section = parseBrief(body).sections[SHAPING_DECISIONS] ?? "";
	return parseChecklist(section).map((item) => {
		const tag = DECISION_TAG_RE.exec(item.text);
		return {
			text: item.text.replace(DECISION_TAG_RE, "").trim(),
			checked: item.checked,
			settledBy: tag === null ? "human" : "research",
		};
	});
}

function decisionLine(decision: string, settledBy: DecisionSettler): string {
	const tag = settledBy === "research" ? " (research)" : "";
	return `- [ ] ${decision.trim()}${tag}`;
}

// Append `line` to the end of the `## <section>` block, creating the section
// at the end of the body when missing.
function appendToSection(body: string, section: string, line: string): string {
	const lines = body.trimEnd().split("\n");
	let sectionStart = -1;
	let sectionEnd = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const heading = HEADING_RE.exec(lines[i] ?? "");
		if (heading?.[1] !== "##") continue;
		if (sectionStart !== -1) {
			sectionEnd = i;
			break;
		}
		if (heading[2]?.trim() === section) sectionStart = i;
	}
	if (sectionStart === -1) {
		return `${lines.join("\n")}\n\n## ${section}\n\n${line}\n`;
	}
	// Replace the section's trailing blank lines with the new line, a blank
	// after the heading when the section was empty, and a blank before the next
	// heading when one follows.
	let end = sectionEnd;
	while (end > sectionStart + 1 && (lines[end - 1] ?? "").trim() === "") end--;
	lines.splice(
		end,
		sectionEnd - end,
		...(end === sectionStart + 1 ? ["", line] : [line]),
		...(sectionEnd < lines.length ? [""] : []),
	);
	return `${lines.join("\n")}\n`;
}

export function appendDecision(
	body: string,
	decision: string,
	settledBy: DecisionSettler,
): string {
	return appendToSection(
		body,
		SHAPING_DECISIONS,
		decisionLine(decision, settledBy),
	);
}

// Check the matching open decision off and fold the answer into the agreed
// notes; undefined when no unchecked decision matches. The first unchecked
// normalized match wins, so duplicates resolve deterministically.
export function resolveDecision(
	body: string,
	decision: string,
	answer: string,
): string | undefined {
	const target = normalizeDecision(decision);
	const lines = body.split("\n");
	const range = sectionRange(lines, SHAPING_DECISIONS);
	if (range === undefined) return undefined;
	const item = scanChecklist(lines, range.start, range.end).find(
		(each) => each.mark === " " && normalizeDecision(each.text) === target,
	);
	if (item === undefined) return undefined;
	lines[item.line] = (lines[item.line] ?? "").replace("[ ]", "[x]");
	return appendToSection(
		lines.join("\n"),
		SHAPING_NOTES,
		`- ${normalizeDecision(item.text)}: ${answer.trim()}`,
	);
}

// The six brief headings in template order, Goal filled and the rest empty.
export function buildStoryBody(title: string, goal: string): string {
	const blocks = BRIEF_SECTIONS.map((section) =>
		section === "Goal" ? `## Goal\n\n${goal.trim()}` : `## ${section}`,
	);
	return `# ${title}\n\n${blocks.join("\n\n")}\n`;
}

// `# Title`, the goal paragraph, then the rationale paragraph when present.
export function buildEpicBody(
	title: string,
	goal: string,
	rationale?: string,
): string {
	const parts = [`# ${title}`, goal.trim()];
	if (rationale !== undefined) parts.push(rationale.trim());
	return `${parts.join("\n\n")}\n`;
}

// Fold lines under Approach (`- <question>: <answer>`, written by
// resolveQuestion) whose question is a checked Open questions item.
function questionFolds(body: string): string[] {
	const lines = body.split("\n");
	const questions = sectionRange(lines, "Open questions");
	const approach = sectionRange(lines, "Approach");
	if (questions === undefined || approach === undefined) return [];
	const checked = scanChecklist(lines, questions.start, questions.end)
		.filter((item) => item.mark !== " ")
		.map((item) => item.text);
	if (checked.length === 0) return [];
	return lines
		.slice(approach.start, approach.end)
		.filter((line) => checked.some((q) => line.startsWith(`- ${q}:`)));
}

// Replace the `## <section>` block (up to the next `## ` heading or EOF). A
// missing heading is inserted at its BRIEF_SECTIONS position relative to the
// headings already present. Replacing Approach keeps the fold lines of
// resolved open questions, so a section accept never erases a resolution
// recorded between the proposal and the accept.
export function replaceBriefSection(
	body: string,
	section: BriefSection,
	content: string,
): string {
	const parts = body.split(/(?=^##\s)/m);
	const preamble = parts[0] ?? "";
	const blocks = parts.slice(1).map((text) => {
		const heading = HEADING_RE.exec(text.split("\n", 1)[0] ?? "");
		return {
			name: heading?.[1] === "##" ? (heading[2]?.trim() ?? "") : "",
			text,
		};
	});
	const kept =
		section === "Approach"
			? questionFolds(body).filter((line) => !content.includes(line))
			: [];
	const filled = [content.trim(), ...kept].join("\n");
	const block = {
		name: section,
		text: `## ${section}\n\n${filled}\n\n`,
	};
	const at = blocks.findIndex((b) => b.name === section);
	if (at !== -1) {
		blocks[at] = block;
	} else {
		const order = BRIEF_SECTIONS as readonly string[];
		const rank = order.indexOf(section);
		const insertAt = blocks.findIndex((b) => order.indexOf(b.name) > rank);
		blocks.splice(insertAt === -1 ? blocks.length : insertAt, 0, block);
	}
	const rebuilt = preamble + blocks.map((b) => b.text).join("");
	return `${rebuilt.trimEnd()}\n`;
}

// Append a run's note as one bullet under the trailing `## Run notes`
// section (created on first use). The note is collapsed to a single line and
// stripped of leading heading markers, so by construction it can never carry
// a heading (`parseBrief` is last-occurrence-wins) or a frontmatter fence.
export function appendRunNote(body: string, note: string): string {
	const sanitized = note
		.split("\n")
		.map((line) => line.replace(/^\s*#+\s*/, "").trim())
		.filter((line) => line !== "" && !/^-{3,}$/.test(line))
		.join(" ");
	if (sanitized === "") return body;
	return appendToSection(body, RUN_NOTES_SECTION, `- ${sanitized}`);
}

// File an accepted gate flag as a new unchecked open question.
export function appendOpenQuestion(body: string, question: string): string {
	return appendToSection(body, "Open questions", `- [ ] ${question.trim()}`);
}

// Set the matching `- [ ] <question>` under Open questions to `- [x]`;
// undefined when no unchecked item matches the text exactly.
function checkQuestion(body: string, question: string): string | undefined {
	const lines = body.split("\n");
	const range = sectionRange(lines, "Open questions");
	if (range === undefined) return undefined;
	const target = question.trim();
	const item = scanChecklist(lines, range.start, range.end).find(
		(each) => each.mark === " " && each.text === target,
	);
	if (item === undefined) return undefined;
	lines[item.line] = (lines[item.line] ?? "").replace("[ ]", "[x]");
	return lines.join("\n");
}

// Check the matching open question off and fold the answer into the Approach
// section; undefined when no unchecked question matches the text exactly. The
// fold line is written unwrapped, which is what keeps `questionFolds` able to
// match it against the folded question text.
export function resolveQuestion(
	body: string,
	question: string,
	answer: string,
): string | undefined {
	const checked = checkQuestion(body, question);
	if (checked === undefined) return undefined;
	return appendToSection(
		checked,
		"Approach",
		`- ${question.trim()}: ${answer.trim()}`,
	);
}
