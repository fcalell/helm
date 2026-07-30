import { readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { briefHash } from "../board/hash.ts";
import { parseBrief } from "../board/markdown.ts";
import type { CriterionItem } from "../board/schema.ts";
import {
	isENOENT,
	readStoryFile,
	type Story,
	writeStory,
} from "../board/store.ts";
import { dispatch } from "./dispatcher.ts";
import type { ReadyBinding } from "./mcp/registry.ts";
import type { CriterionGrade, GradeCriteriaPayload } from "./mcp/schemas.ts";
import { readRepoConfig } from "./repo-config.ts";
import { broadcastNotice, managedRepo } from "./services/board.ts";
import {
	briefFilePath,
	type CheckResult,
	checkCommandTools,
	checkFilePath,
	checkResultSchema,
	findStory,
	reviewFilePath,
	reviewGradesSchema,
} from "./services/runs.ts";
import { runFreshTurn } from "./services/sessions.ts";
import { worktreePath } from "./worktrees.ts";
import { enqueueWrite } from "./write-queue.ts";

let log: { info(m: string): void; error(m: string): void } | undefined;

export function setGraderLog(logger: {
	info(m: string): void;
	error(m: string): void;
}): void {
	log = logger;
}

// One in-flight grading per story: the criteria snapshot the grader must cover
// (canonical tag-stripped text), the brief hash it binds to, the worktree it
// reads, and the session id of the spawn allowed to record grades. `grades`
// holds a landed grade_criteria call.
interface GradingSlot {
	criteria: CriterionItem[];
	briefHash: string;
	worktree: string;
	sessionId?: string;
	grades?: CriterionGrade[];
}

const slots = new Map<string, GradingSlot>();

// A mode tag the model may have re-appended to the criterion string; stripped
// so the grade still matches the canonical (tag-free) criterion text.
const TRAILING_MODE_RE = /\s*\((?:test|command|file|live)\)$/;

// Fire-and-forget from the review close: never blocks or fails it.
export function dispatchReviewGrading(storyId: string): void {
	void dispatch(() => runGrading(storyId), {
		kind: "review",
		storyId,
	}).catch((error) => {
		log?.error(`grader ${storyId}: ${String(error)}`);
	});
}

async function readCheck(storyId: string): Promise<CheckResult | undefined> {
	let raw: string;
	try {
		raw = await readFile(checkFilePath(storyId), "utf8");
	} catch (error) {
		if (isENOENT(error)) return undefined;
		throw error;
	}
	try {
		const parsed = checkResultSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

function checkBlock(check: CheckResult | undefined): string {
	if (check === undefined) {
		return "No check command configured for this repo — grade (command) and (test) criteria unclear.";
	}
	const status =
		check.exitCode === null ? "timed out" : `exited ${check.exitCode}`;
	return [
		`The repo's check command \`${check.command}\` ${status}. Its output:`,
		"",
		"<check-output>",
		check.output.trimEnd(),
		"</check-output>",
	].join("\n");
}

// Each line names the criterion text (the exact string to echo in the
// `criterion` field) and its mode separately, so "grade each verbatim" never
// tempts the model to fold the mode tag into the criterion string.
function criteriaBlock(criteria: CriterionItem[]): string {
	return criteria
		.map((c) => `- criterion: ${c.text}\n  mode: ${c.mode ?? "untagged"}`)
		.join("\n");
}

function gradingPrompt(
	criteria: CriterionItem[],
	check: CheckResult | undefined,
	briefBody: string,
	corrective?: string,
): string {
	const parts = [
		"Grade every acceptance criterion of the finished run below.",
		"",
		"The acceptance criteria, each with its verification mode:",
		"",
		criteriaBlock(criteria),
		"",
		checkBlock(check),
		"",
		"The story brief:",
		"",
		"<brief>",
		briefBody.trimEnd(),
		"</brief>",
	];
	if (corrective !== undefined) parts.push("", corrective);
	return parts.join("\n");
}

// Tool entry: the review session's grade_criteria. Returns an error string for
// the tool result (the model corrects in-turn), or undefined on success.
export function recordReviewGrades(
	binding: ReadyBinding,
	payload: GradeCriteriaPayload,
): string | undefined {
	const storyId = binding.attach?.type === "story" ? binding.attach.id : "";
	const slot = slots.get(storyId);
	if (slot === undefined || slot.sessionId !== binding.sessionId) {
		return "no review grading is running for this story";
	}
	const expected = new Set(slot.criteria.map((c) => c.text));
	const seen = new Set<string>();
	for (const grade of payload.grades) {
		// Tolerate a model that folded the mode tag back onto the criterion.
		const criterion = grade.criterion.replace(TRAILING_MODE_RE, "").trim();
		if (!expected.has(criterion)) {
			return `unknown criterion "${grade.criterion}"; grade each criterion verbatim from the list in your prompt`;
		}
		if (seen.has(criterion)) {
			return `criterion "${criterion}" is graded twice; grade each exactly once`;
		}
		seen.add(criterion);
		grade.criterion = criterion;
	}
	const ungraded = slot.criteria.filter((c) => !seen.has(c.text));
	const firstUngraded = ungraded[0];
	if (firstUngraded !== undefined) {
		return `${ungraded.length} criterion(s) left ungraded, starting with "${firstUngraded.text}"; one grade_criteria call must cover every criterion`;
	}
	slot.grades = payload.grades;
	return undefined;
}

// The first path-looking token in the evidence: an absolute or dotted/slashed
// relative path. Used to stat a (file) pass's cited file inside the worktree.
const PATH_RE = /(?:^|\s)((?:\.{0,2}\/)?[\w./-]*\/[\w./-]+)/;

async function verifyFileGrades(
	slot: GradingSlot,
	grades: CriterionGrade[],
): Promise<CriterionGrade[]> {
	const modeOf = new Map(slot.criteria.map((c) => [c.text, c.mode]));
	const verified: CriterionGrade[] = [];
	for (const grade of grades) {
		if (grade.verdict !== "pass" || modeOf.get(grade.criterion) !== "file") {
			verified.push(grade);
			continue;
		}
		const token = PATH_RE.exec(grade.evidence)?.[1];
		const target =
			token === undefined
				? undefined
				: isAbsolute(token)
					? token
					: join(slot.worktree, token);
		let exists = false;
		if (target !== undefined) {
			try {
				await stat(target);
				exists = true;
			} catch {
				exists = false;
			}
		}
		if (exists) {
			verified.push(grade);
		} else {
			verified.push({
				...grade,
				verdict: "unclear",
				evidence: `${grade.evidence}\n[orchestrator: cited file ${token ?? "(none named)"} not found in the worktree]`,
			});
		}
	}
	return verified;
}

async function runGrading(storyId: string): Promise<void> {
	const repo = managedRepo();
	const worktree = worktreePath(repo, storyId);

	let briefBody: string;
	try {
		briefBody = await readFile(briefFilePath(storyId), "utf8");
	} catch (error) {
		log?.error(
			`grader ${storyId}: brief snapshot unreadable: ${String(error)}`,
		);
		return;
	}
	const criteria = parseBrief(briefBody).criteria;
	if (criteria.length === 0) {
		log?.info(`grader ${storyId}: no criteria to grade`);
		return;
	}
	const check = await readCheck(storyId);

	const slot: GradingSlot = {
		criteria,
		briefHash: briefHash(briefBody),
		worktree,
	};
	slots.set(storyId, slot);
	try {
		const landed =
			(await grade(storyId, slot, criteria, check, briefBody)) ||
			(await grade(
				storyId,
				slot,
				criteria,
				check,
				briefBody,
				"Your previous turn ended without a valid grade_criteria call. Report now through exactly one grade_criteria call covering every criterion verbatim, then end your turn.",
			));
		if (!landed) {
			broadcastNotice({
				kind: "grade-failed",
				message: `Review for ${storyId} left ungraded: the grader returned no valid grades`,
			});
			return;
		}
		const verified = await verifyFileGrades(slot, slot.grades ?? []);
		await landGrades(storyId, slot, verified);
	} finally {
		if (slots.get(storyId) === slot) slots.delete(storyId);
	}
}

// One grading attempt: reset any prior grades, spawn the cold review session,
// bind its session id to the slot, and await the turn. True when a valid
// grade_criteria call landed.
async function grade(
	storyId: string,
	slot: GradingSlot,
	criteria: CriterionItem[],
	check: CheckResult | undefined,
	briefBody: string,
	corrective?: string,
): Promise<boolean> {
	slot.grades = undefined;
	slot.sessionId = undefined;
	const { checkCommand } = await readRepoConfig(managedRepo());
	const spawn = await runFreshTurn({
		kind: "review",
		prompt: gradingPrompt(criteria, check, briefBody, corrective),
		attach: { type: "story", id: storyId },
		cwd: slot.worktree,
		extraTools:
			checkCommand !== undefined ? checkCommandTools(checkCommand) : [],
	}).catch((error) => {
		log?.error(`grader ${storyId}: spawn failed: ${String(error)}`);
		return undefined;
	});
	if (spawn === undefined) return false;
	slot.sessionId = spawn.sessionId;
	await spawn.done;
	return slot.grades !== undefined;
}

// Write the typed grade record, then a guarded frontmatter update: only a
// story still in review whose last run closed in review, on the same session
// and brief the grader graded, takes the "N/M" tally. Anything else drops.
async function landGrades(
	storyId: string,
	slot: GradingSlot,
	grades: CriterionGrade[],
): Promise<void> {
	const passes = grades.filter((g) => g.verdict === "pass").length;
	const tally = `${passes}/${grades.length}`;
	try {
		await writeFile(
			reviewFilePath(storyId),
			`${JSON.stringify(
				reviewGradesSchema.parse({
					grades,
					gradedAt: new Date().toISOString(),
					brief: slot.briefHash,
				}),
				null,
				"\t",
			)}\n`,
		);
	} catch (error) {
		log?.error(`grader ${storyId}: review file write failed: ${String(error)}`);
		return;
	}
	let known: ReturnType<typeof findStory>;
	try {
		known = findStory(storyId);
	} catch {
		log?.info(`grader ${storyId}: story gone; grades dropped`);
		return;
	}
	await enqueueWrite(async () => {
		let current: Story;
		try {
			current = await readStoryFile(known.path, known.epicId);
		} catch {
			return;
		}
		if (current.frontmatter.status !== "review") {
			log?.info(`grader ${storyId}: story left review; grades dropped`);
			return;
		}
		const runs = [...current.frontmatter.runs];
		const last = runs.at(-1);
		if (
			last === undefined ||
			last.outcome !== "review" ||
			last.brief !== slot.briefHash
		) {
			log?.info(`grader ${storyId}: run entry changed; grades dropped`);
			return;
		}
		runs[runs.length - 1] = { ...last, grades: tally };
		await writeStory({
			path: current.path,
			frontmatter: { ...current.frontmatter, runs },
			body: current.body,
		});
	});
}
