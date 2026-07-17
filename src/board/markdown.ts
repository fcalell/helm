import { Document, isMap, isSeq } from "yaml";
import {
	BRIEF_SECTIONS,
	type Brief,
	type BriefSection,
	type ChecklistItem,
	type EpicFrontmatter,
	type StoryFrontmatter,
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
const CHECKLIST_RE = /^\s*[-*]\s*\[([ xX])\]\s+(.*)$/;

export function parseChecklist(text: string): ChecklistItem[] {
	const items: ChecklistItem[] = [];
	for (const line of text.split("\n")) {
		const match = CHECKLIST_RE.exec(line);
		const mark = match?.[1];
		const label = match?.[2];
		if (mark === undefined || label === undefined) continue;
		items.push({ text: label.trim(), checked: mark !== " " });
	}
	return items;
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
		criteria: parseChecklist(sections["Acceptance criteria"] ?? ""),
		openQuestions: parseChecklist(sections["Open questions"] ?? ""),
	};
}

function stringifyFrontmatter(ordered: Record<string, unknown>): string {
	const doc = new Document(ordered);
	const sessions = doc.get("sessions", true);
	if (isMap(sessions)) sessions.flow = true;
	const gate = doc.get("gate", true);
	if (isMap(gate)) gate.flow = true;
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
	const { id, status, depends, size, branch, gate, sessions, runs } =
		frontmatter;
	const ordered: Record<string, unknown> = { id, status, depends };
	if (size !== undefined) ordered.size = size;
	if (branch !== undefined) ordered.branch = branch;
	if (gate !== undefined) ordered.gate = gate;
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

// Replace the `## <section>` block (up to the next `## ` heading or EOF). A
// missing heading is inserted at its BRIEF_SECTIONS position relative to the
// headings already present.
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
	const block = {
		name: section,
		text: `## ${section}\n\n${content.trim()}\n\n`,
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

// Set the matching `- [ ] <question>` under Open questions to `- [x]`;
// undefined when no unchecked item matches the text exactly.
export function checkQuestion(
	body: string,
	question: string,
): string | undefined {
	const lines = body.split("\n");
	const target = question.trim();
	let inSection = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const heading = HEADING_RE.exec(line);
		if (heading !== null) {
			inSection =
				heading[1] === "##" && heading[2]?.trim() === "Open questions";
			continue;
		}
		if (!inSection) continue;
		const match = CHECKLIST_RE.exec(line);
		if (match?.[1] === " " && match[2]?.trim() === target) {
			lines[i] = line.replace("[ ]", "[x]");
			return lines.join("\n");
		}
	}
	return undefined;
}
