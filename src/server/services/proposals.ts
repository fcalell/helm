import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import { ApiError } from "@fcalell/plugin-api/error";
import { z } from "@fcalell/plugin-api/schema";
import { type ChannelHandle, defineService } from "@fcalell/plugin-node/server";
import { createEpic, createStory } from "../../board/create.ts";
import {
	appendDecision,
	buildEpicBody,
	replaceBriefSection,
	resolveDecision,
	resolveQuestion,
} from "../../board/markdown.ts";
import { nextEpicOrdinal, nextStoryOrdinal } from "../../board/ordinals.ts";
import {
	epicFilePath,
	InvalidBoardFileError,
	isENOENT,
	readEpicFile,
	readShapingFile,
	readStoryFile,
	type ShapingThread,
	STORY_FILE_RE,
	shapingPath,
	writeEpic,
	writeShaping,
	writeStory,
} from "../../board/store.ts";
import {
	decisionResolvedPrompt,
	proposalOutcomePrompt,
	questionAnswerPrompt,
} from "../../sessions/prompts.ts";
import { proposalChannel } from "../../shared/channels.ts";
import type { ReadyBinding } from "../mcp/registry.ts";
import type {
	AskUserPayload,
	EpicBody,
	Proposal,
	ProposalResolution,
	Question,
} from "../mcp/schemas.ts";
import {
	epicDraftSchema,
	proposalSchema,
	questionSchema,
	raiseDecisionPayloadSchema,
	resolveQuestionPayloadSchema,
	storyDraftSchema,
	updateBriefPayloadSchema,
} from "../mcp/schemas.ts";
import { enqueueWrite } from "../write-queue.ts";
import { boardSnapshot, managedRepo } from "./board.ts";
import { gateBriefEdited, gateFixRejected } from "./gate.ts";
import {
	type Attach,
	isSessionLive,
	messageSession,
	onSessionClosed,
} from "./sessions.ts";

// In-memory only: a pending proposal or question dies with the process (the
// chat resumes and re-proposes). `contexts` carries per-proposal state the wire
// schema does not: the bound card, the slug -> minted id map that resolves
// `depends` across accepted items, and whether a define proposal's epic body
// was already completed (one write per proposal, not per accepted story).
interface ProposalContext {
	attach?: Attach;
	accepted: Map<string, string>;
	epicCompleted?: boolean;
}
const proposals = new Map<string, Proposal>();
const questions = new Map<string, Question>();
const contexts = new Map<string, ProposalContext>();
const heldResumes = new Map<string, string[]>();
let handle: ChannelHandle<(typeof proposalChannel)["server"]> | undefined;

const ITEM_SCHEMA: Record<Proposal["tool"], z.ZodType> = {
	propose_epics: epicDraftSchema,
	propose_stories: storyDraftSchema,
	update_brief: updateBriefPayloadSchema,
	resolve_question: resolveQuestionPayloadSchema,
	raise_decision: raiseDecisionPayloadSchema,
};

function snapshot(): { proposals: Proposal[]; questions: Question[] } {
	return {
		proposals: [...proposals.values()],
		questions: [...questions.values()],
	};
}

function broadcast(): void {
	handle?.broadcast("snapshot", snapshot());
}

export function recordProposal(
	binding: ReadyBinding,
	tool: Proposal["tool"],
	items: unknown[],
	extra?: { epic?: string; epicBody?: EpicBody },
): Proposal {
	const proposal = proposalSchema.parse({
		id: randomUUID(),
		sessionId: binding.sessionId,
		kind: binding.kind,
		createdAt: new Date().toISOString(),
		tool,
		...(extra?.epic !== undefined ? { epic: extra.epic } : {}),
		...(extra?.epicBody !== undefined ? { epicBody: extra.epicBody } : {}),
		items: items.map((payload) => ({ payload })),
	});
	proposals.set(proposal.id, proposal);
	contexts.set(proposal.id, { attach: binding.attach, accepted: new Map() });
	broadcast();
	return proposal;
}

export function recordQuestion(
	binding: ReadyBinding,
	payload: AskUserPayload,
): Question {
	const question = questionSchema.parse({
		id: randomUUID(),
		sessionId: binding.sessionId,
		kind: binding.kind,
		createdAt: new Date().toISOString(),
		...payload,
	});
	questions.set(question.id, question);
	broadcast();
	return question;
}

export async function resolveProposalItem(input: {
	proposalId: string;
	item: number;
	resolution: ProposalResolution;
}): Promise<void> {
	const proposal = proposals.get(input.proposalId);
	const item = proposal?.items[input.item];
	if (proposal === undefined || item === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no proposal item ${input.proposalId}[${input.item}]`,
		});
	}
	if (item.resolution !== undefined) {
		throw new ApiError("PROPOSAL_RESOLVED", {
			status: 409,
			message: "this item is already resolved",
		});
	}
	const { resolution } = input;
	if (resolution.type === "edit") {
		const parsed = ITEM_SCHEMA[proposal.tool].safeParse(resolution.payload);
		if (!parsed.success) {
			throw new ApiError("BAD_REQUEST", {
				message: z.prettifyError(parsed.error),
			});
		}
		// The store owns this object and the payload was just re-validated against
		// the tool's item schema; the union widens `payload` to `never` here.
		(item as { payload: unknown }).payload = parsed.data;
	}
	if (resolution.type === "accept") {
		await enqueueWrite(() => applyItem(proposal, input.item));
		notifyGate(proposal, input.item);
	} else if (resolution.type === "reject" && proposal.tool === "update_brief") {
		const attach = contexts.get(proposal.id)?.attach;
		const resolves = proposal.items[input.item]?.payload.resolves;
		if (attach?.type === "story" && resolves !== undefined) {
			gateFixRejected(attach.id, resolves);
		}
	}
	item.resolution = resolution;
	broadcast();
	if (proposal.items.every((each) => each.resolution !== undefined)) {
		proposals.delete(proposal.id);
		contexts.delete(proposal.id);
		broadcast();
		const changed = proposal.items.some(
			(each) =>
				each.resolution?.type === "edit" || each.resolution?.type === "reject",
		);
		if (changed)
			await dispatchResume(proposal.sessionId, composeOutcome(proposal));
	}
}

export async function answerQuestion(input: {
	questionId: string;
	answer: string;
}): Promise<void> {
	const question = questions.get(input.questionId);
	if (question === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no question with id ${input.questionId}`,
		});
	}
	questions.delete(input.questionId);
	broadcast();
	if (question.kind === "shape") {
		await tryResolveDecision(
			question.sessionId,
			question.question,
			input.answer,
		);
	}
	await dispatchResume(
		question.sessionId,
		questionAnswerPrompt(question.question, input.answer),
	);
}

export function hasPendingDecision(sessionId: string): boolean {
	for (const proposal of proposals.values()) {
		if (proposal.tool !== "raise_decision") continue;
		if (proposal.sessionId !== sessionId) continue;
		if (proposal.items.some((item) => item.resolution === undefined)) {
			return true;
		}
	}
	return false;
}

async function tryResolveDecision(
	sessionId: string,
	decision: string,
	answer: string,
): Promise<void> {
	const thread = boardSnapshot().shaping.find(
		(each) => each.frontmatter.sessions.shape === sessionId,
	);
	if (thread === undefined) return;
	await enqueueWrite(async () => {
		const current = await readShapingThread(thread.slug);
		const body = resolveDecision(current.body, decision, answer);
		if (body === undefined) return;
		await writeShaping({
			path: current.path,
			frontmatter: current.frontmatter,
			body,
		});
	});
}

export async function resolveShapingDecision(input: {
	slug: string;
	decision: string;
	answer: string;
}): Promise<void> {
	const sessionId = await enqueueWrite(async () => {
		const thread = await readShapingThread(input.slug);
		const body = resolveDecision(thread.body, input.decision, input.answer);
		if (body === undefined) {
			throw new ApiError("NOT_FOUND", {
				message: `no open decision matching "${input.decision}"`,
			});
		}
		await writeShaping({
			path: thread.path,
			frontmatter: thread.frontmatter,
			body,
		});
		return thread.frontmatter.sessions.shape;
	});
	if (sessionId !== undefined) {
		await dispatchResume(
			sessionId,
			decisionResolvedPrompt(input.decision, input.answer),
		);
	}
}

async function applyItem(proposal: Proposal, index: number): Promise<void> {
	const repoPath = managedRepo().path;
	switch (proposal.tool) {
		case "propose_epics": {
			const draft = proposal.items[index]?.payload;
			if (draft === undefined) return;
			const ordinal = await nextEpicOrdinal(repoPath);
			const { epicId, dir } = await createEpic(repoPath, ordinal, {
				slug: draft.slug,
				title: draft.title,
				goal: draft.goal,
				rationale: draft.rationale,
			});
			// All draft-story ids are known up front (ordinals 1..N in payload
			// order), so `depends` resolves order-independently among the drafts.
			const slugToId = new Map<string, string>(
				draft.stories.map((story, i) => [
					story.slug,
					`${epicId}-${String(i + 1).padStart(2, "0")}`,
				]),
			);
			for (const [i, story] of draft.stories.entries()) {
				await createStory(dir, epicId, i + 1, {
					slug: story.slug,
					title: story.title,
					goal: story.goal,
					depends: resolveDepends(story.depends, (slug) => slugToId.get(slug)),
				});
			}
			return;
		}
		case "propose_stories": {
			const draft = proposal.items[index]?.payload;
			if (draft === undefined) return;
			const { epicId, dir } = resolveTargetEpic(proposal);
			const context = contexts.get(proposal.id);
			if (proposal.epicBody !== undefined && context?.epicCompleted !== true) {
				await completeEpicBody(dir, proposal.epicBody);
				if (context !== undefined) context.epicCompleted = true;
			}
			const existing = existingStorySlugs(epicId);
			const depends = resolveDepends(
				draft.depends,
				(slug) => context?.accepted.get(slug) ?? existing.get(slug),
			);
			const ordinal = await nextStoryOrdinal(repoPath, epicId);
			const { storyId } = await createStory(dir, epicId, ordinal, {
				slug: draft.slug,
				title: draft.title,
				goal: draft.goal,
				depends,
			});
			context?.accepted.set(draft.slug, storyId);
			return;
		}
		case "update_brief": {
			const payload = proposal.items[index]?.payload;
			if (payload === undefined) return;
			const current = await readBoundStory(proposal);
			await writeStory({
				path: current.path,
				frontmatter: current.frontmatter,
				body: replaceBriefSection(
					current.body,
					payload.section,
					payload.content,
				),
			});
			return;
		}
		case "resolve_question": {
			const payload = proposal.items[index]?.payload;
			if (payload === undefined) return;
			const current = await readBoundStory(proposal);
			const body = resolveQuestion(
				current.body,
				payload.question,
				payload.answer,
			);
			if (body === undefined) {
				throw new ApiError("NOT_FOUND", {
					message: `no unchecked open question matching "${payload.question}"`,
				});
			}
			await writeStory({
				path: current.path,
				frontmatter: current.frontmatter,
				body,
			});
			return;
		}
		case "raise_decision": {
			const payload = proposal.items[index]?.payload;
			if (payload === undefined) return;
			const attach = contexts.get(proposal.id)?.attach;
			if (attach?.type !== "shaping") {
				throw new ApiError("BAD_REQUEST", {
					message: "this proposal is not bound to a shaping thread",
				});
			}
			const thread = await readShapingThread(attach.id);
			await writeShaping({
				path: thread.path,
				frontmatter: thread.frontmatter,
				body: appendDecision(thread.body, payload.decision, payload.settledBy),
			});
			return;
		}
	}
}

// An accepted brief edit re-evaluates the story's gate round; a fix's
// `resolves` settles its flag first.
function notifyGate(proposal: Proposal, index: number): void {
	const attach = contexts.get(proposal.id)?.attach;
	if (attach?.type !== "story") return;
	if (proposal.tool === "update_brief") {
		gateBriefEdited(attach.id, proposal.items[index]?.payload.resolves);
	} else if (proposal.tool === "resolve_question") {
		gateBriefEdited(attach.id);
	}
}

// Completing a define breakdown rewrites the epic body from its accepted
// goal and rationale, keeping the title the `n` entry wrote.
async function completeEpicBody(
	dir: string,
	epicBody: EpicBody,
): Promise<void> {
	const path = epicFilePath(dir);
	const epic = await readEpicFile(path);
	await writeEpic({
		path,
		frontmatter: epic.frontmatter,
		body: buildEpicBody(epic.title, epicBody.goal, epicBody.rationale),
	});
}

async function readShapingThread(slug: string): Promise<ShapingThread> {
	try {
		return await readShapingFile(shapingPath(managedRepo().path, slug));
	} catch (error) {
		if (isENOENT(error)) {
			throw new ApiError("NOT_FOUND", {
				message: `no shaping thread with slug ${slug}`,
			});
		}
		if (error instanceof InvalidBoardFileError) {
			throw new ApiError("INVALID_FILE", {
				status: 409,
				message: error.message,
			});
		}
		throw error;
	}
}

function resolveTargetEpic(proposal: Proposal): {
	epicId: string;
	dir: string;
} {
	if (proposal.tool !== "propose_stories") {
		throw new Error("resolveTargetEpic called for a non-story proposal");
	}
	if (proposal.epic !== undefined) {
		const matches = boardSnapshot().epics.filter(
			(epic) => epic.slug === proposal.epic,
		);
		if (matches.length === 0) {
			throw new ApiError("NOT_FOUND", {
				message: `no epic with slug ${proposal.epic}`,
			});
		}
		if (matches.length > 1 || matches[0] === undefined) {
			throw new ApiError("BAD_REQUEST", {
				message: `epic slug ${proposal.epic} is ambiguous`,
			});
		}
		return { epicId: matches[0].id, dir: dirname(matches[0].path) };
	}
	const attach = contexts.get(proposal.id)?.attach;
	if (attach?.type !== "epic") {
		throw new ApiError("BAD_REQUEST", {
			message: "this proposal is not bound to an epic",
		});
	}
	const epic = boardSnapshot().epics.find((each) => each.id === attach.id);
	if (epic === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no epic with id ${attach.id}`,
		});
	}
	return { epicId: epic.id, dir: dirname(epic.path) };
}

async function readBoundStory(
	proposal: Proposal,
): Promise<Awaited<ReturnType<typeof readStoryFile>>> {
	const attach = contexts.get(proposal.id)?.attach;
	if (attach?.type !== "story") {
		throw new ApiError("BAD_REQUEST", {
			message: "this proposal is not bound to a story",
		});
	}
	const story = boardSnapshot().stories.find((each) => each.id === attach.id);
	if (story === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no story with id ${attach.id}`,
		});
	}
	try {
		return await readStoryFile(story.path, story.epicId);
	} catch (error) {
		if (isENOENT(error)) {
			throw new ApiError("NOT_FOUND", {
				message: `no story with id ${attach.id}`,
			});
		}
		if (error instanceof InvalidBoardFileError) {
			throw new ApiError("INVALID_FILE", {
				status: 409,
				message: error.message,
			});
		}
		throw error;
	}
}

function existingStorySlugs(epicId: string): Map<string, string> {
	const slugs = new Map<string, string>();
	for (const story of boardSnapshot().stories) {
		if (story.epicId !== epicId) continue;
		const slug = STORY_FILE_RE.exec(basename(story.path))?.[2];
		if (slug !== undefined) slugs.set(slug, story.id);
	}
	return slugs;
}

function resolveDepends(
	depends: string[],
	lookup: (slug: string) => string | undefined,
): string[] {
	return depends.map((slug) => {
		const id = lookup(slug);
		if (id === undefined) {
			throw new ApiError("BAD_REQUEST", {
				message: `unresolved dependency: no sibling story "${slug}"`,
			});
		}
		return id;
	});
}

function itemSummary(proposal: Proposal, index: number): string {
	switch (proposal.tool) {
		case "propose_epics":
			return proposal.items[index]?.payload.title ?? "";
		case "propose_stories":
			return proposal.items[index]?.payload.title ?? "";
		case "update_brief":
			return `${proposal.items[index]?.payload.section ?? ""} section`;
		case "resolve_question":
			return proposal.items[index]?.payload.question ?? "";
		case "raise_decision":
			return proposal.items[index]?.payload.decision ?? "";
	}
}

function composeOutcome(proposal: Proposal): string {
	const items = proposal.items.map((item, index) => {
		const resolution = item.resolution;
		if (resolution?.type === "reject") {
			return {
				summary: itemSummary(proposal, index),
				outcome: "reject" as const,
				detail: resolution.reason,
			};
		}
		if (resolution?.type === "edit") {
			const payload = JSON.stringify(item.payload);
			return {
				summary: itemSummary(proposal, index),
				outcome: "edit" as const,
				detail:
					resolution.note === undefined
						? payload
						: `${payload} (note: ${resolution.note})`,
			};
		}
		return {
			summary: itemSummary(proposal, index),
			outcome: "accept" as const,
		};
	});
	return proposalOutcomePrompt(proposal.tool, items);
}

async function dispatchResume(
	sessionId: string,
	message: string,
): Promise<void> {
	if (isSessionLive(sessionId)) {
		heldResumes.set(sessionId, [
			...(heldResumes.get(sessionId) ?? []),
			message,
		]);
		return;
	}
	await messageSession({ sessionId, prompt: message });
}

export default defineService({
	name: "proposals",
	start: (ctx) => {
		handle = ctx.ws.channel(proposalChannel, {
			onSubscribe: (conn) => {
				conn.send("snapshot", snapshot());
			},
		});
		onSessionClosed(({ sessionId }) => {
			if (handle === undefined || sessionId === undefined) return;
			const held = heldResumes.get(sessionId);
			if (held === undefined || held.length === 0) return;
			heldResumes.delete(sessionId);
			void messageSession({ sessionId, prompt: held.join("\n\n") }).catch(
				(error) =>
					ctx.log.error(`proposals: held resume failed: ${String(error)}`),
			);
		});
		return () => {
			handle = undefined;
			proposals.clear();
			questions.clear();
			contexts.clear();
			heldResumes.clear();
		};
	},
});
