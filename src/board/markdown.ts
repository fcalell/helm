import { Document, isMap, isSeq } from "yaml";
import type {
	Brief,
	ChecklistItem,
	EpicFrontmatter,
	StoryFrontmatter,
} from "./schema.ts";

export interface SplitFile {
	head: string;
	body: string;
}

export function splitFrontmatter(raw: string): SplitFile | undefined {
	if (!raw.startsWith("---\n")) return undefined;
	const close = raw.indexOf("\n---\n", 3);
	if (close === -1) return undefined;
	return { head: raw.slice(4, close + 1), body: raw.slice(close + 5) };
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
	const { id, status, depends, branch, sessions, runs } = frontmatter;
	const ordered: Record<string, unknown> = { id, status, depends };
	if (branch !== undefined) ordered.branch = branch;
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
