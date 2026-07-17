import { toast } from "@fcalell/plugin-solid-ui/components/toast";
import { createStore, produce } from "solid-js/store";
import type {
	Proposal,
	ProposalResolution,
	ProposalSnapshot,
	Question,
} from "../../server/mcp/schemas.ts";
import type { SessionClosed, SessionWireEvent } from "../../sessions/events.ts";
import { proposalChannel, sessionChannel } from "../../shared/channels.ts";
import { api } from "./api.ts";
import {
	extractProposalId,
	extractQuestionId,
	parseAssistantEvent,
	parseContentBlock,
	parseStreamEvent,
	parseUserEvent,
	toolResultText,
} from "./chat-events.ts";
import { wsClient } from "./ws.ts";

export type ChatItem =
	| { type: "user"; text: string }
	| { type: "assistant"; text: string; done: boolean }
	| {
			type: "tool";
			toolUseId: string;
			name: string;
			input?: unknown;
			result?: string;
			isError?: boolean;
			done: boolean;
			proposalId?: string;
			questionId?: string;
	  };

export interface ChatState {
	items: ChatItem[];
	// True while a `claude` process is running this session's turn; the
	// session accepts a new message only after its `closed` frame.
	busy: boolean;
}

// Proposals and questions leave the server's pending snapshot once resolved;
// the log keeps the last-seen version (its final broadcast carries every
// item's resolution) so resolved widgets stay rendered in the transcript.
export type LoggedProposal = Proposal & { pending: boolean };
export type LoggedQuestion = Question & {
	pending: boolean;
	answeredWith?: string;
};

interface SessionsState {
	chats: Record<string, ChatState>;
	proposals: Record<string, LoggedProposal>;
	questions: Record<string, LoggedQuestion>;
	// Story id -> refine spawn in flight this page load; bridges the gap until
	// the board snapshot names the session in frontmatter.
	refineSpawns: Record<string, { sessionId?: string }>;
	connected: boolean;
}

const [store, setStore] = createStore<SessionsState>({
	chats: {},
	proposals: {},
	questions: {},
	refineSpawns: {},
	connected: false,
});

export const sessionStore = store;

// Per-session map from the current message's content-block index to its item
// index.
const blockMaps = new Map<string, Map<number, number>>();
// Texts this client just sent, awaiting their echo as a `user` stream event;
// matching echoes are dropped so a message never renders twice.
const localEcho = new Map<string, string[]>();

function ensureChat(sessionId: string): void {
	if (store.chats[sessionId] === undefined) {
		setStore("chats", sessionId, { items: [], busy: false });
	}
}

function editItems(sessionId: string, fn: (items: ChatItem[]) => void): void {
	setStore("chats", sessionId, "items", produce(fn));
}

function pushUserText(sessionId: string, text: string): void {
	const echoes = localEcho.get(sessionId);
	if (echoes !== undefined && echoes[0] === text) {
		echoes.shift();
		return;
	}
	editItems(sessionId, (items) => {
		items.push({ type: "user", text });
	});
}

function blockMap(sessionId: string): Map<number, number> {
	let map = blockMaps.get(sessionId);
	if (map === undefined) {
		map = new Map();
		blockMaps.set(sessionId, map);
	}
	return map;
}

function handleStreamEvent(sessionId: string, event: SessionWireEvent): void {
	const payload = parseStreamEvent(event.event);
	if (payload === undefined) return;
	if (payload.type === "message_start") {
		blockMaps.set(sessionId, new Map());
		return;
	}
	if (payload.type === "content_block_start") {
		const block = parseContentBlock(payload.content_block);
		if (block === undefined) return;
		editItems(sessionId, (items) => {
			blockMap(sessionId).set(payload.index, items.length);
			if (block.type === "text") {
				items.push({ type: "assistant", text: "", done: false });
			} else {
				items.push({
					type: "tool",
					toolUseId: block.id,
					name: block.name,
					done: false,
				});
			}
		});
		return;
	}
	if (payload.type === "content_block_delta") {
		if (payload.delta.type !== "text_delta") return;
		const text = payload.delta.text;
		if (text === undefined) return;
		const index = blockMap(sessionId).get(payload.index);
		if (index === undefined) return;
		editItems(sessionId, (items) => {
			const item = items[index];
			if (item?.type === "assistant") item.text += text;
		});
	}
}

// The complete message blocks: text finalizes the streamed item, tool_use
// fills in the fully assembled input.
function handleAssistantEvent(
	sessionId: string,
	event: SessionWireEvent,
): void {
	const blocks = parseAssistantEvent(event.event);
	if (blocks === undefined) return;
	editItems(sessionId, (items) => {
		for (const block of blocks) {
			if (block.type === "tool_use") {
				const existing = items.find(
					(item) => item.type === "tool" && item.toolUseId === block.id,
				);
				if (existing?.type === "tool") {
					existing.input = block.input;
				} else {
					items.push({
						type: "tool",
						toolUseId: block.id,
						name: block.name,
						input: block.input,
						done: false,
					});
				}
				continue;
			}
			const open = items.findLast(
				(item) => item.type === "assistant" && !item.done,
			);
			if (open?.type === "assistant") {
				open.text = block.text;
				open.done = true;
			} else if (block.text.trim() !== "") {
				items.push({ type: "assistant", text: block.text, done: true });
			}
		}
	});
}

function handleUserEvent(sessionId: string, event: SessionWireEvent): void {
	const content = parseUserEvent(event.event);
	if (content === undefined) return;
	for (const text of content.texts) pushUserText(sessionId, text);
	if (content.toolResults.length === 0) return;
	editItems(sessionId, (items) => {
		for (const result of content.toolResults) {
			const item = items.find(
				(each) => each.type === "tool" && each.toolUseId === result.tool_use_id,
			);
			if (item?.type !== "tool") continue;
			const text = toolResultText(result);
			item.result = text;
			item.isError = result.is_error ?? false;
			item.done = true;
			if (item.isError) continue;
			item.proposalId = extractProposalId(text);
			item.questionId = extractQuestionId(text);
		}
	});
}

function finalizeChat(sessionId: string): void {
	editItems(sessionId, (items) => {
		for (const item of items) {
			if (item.type !== "user") item.done = true;
		}
	});
}

function handleWireEvent(wire: SessionWireEvent): void {
	const sessionId = wire.sessionId;
	if (sessionId === undefined) return;
	ensureChat(sessionId);
	setStore("chats", sessionId, "busy", true);
	const type = wire.event.type;
	if (type === "stream_event") handleStreamEvent(sessionId, wire);
	else if (type === "assistant") handleAssistantEvent(sessionId, wire);
	else if (type === "user") handleUserEvent(sessionId, wire);
	else if (type === "result") finalizeChat(sessionId);
}

function handleClosed(closed: SessionClosed): void {
	if (closed.sessionId === undefined) return;
	ensureChat(closed.sessionId);
	finalizeChat(closed.sessionId);
	setStore("chats", closed.sessionId, "busy", false);
	blockMaps.delete(closed.sessionId);
}

function applyProposalSnapshot(snapshot: ProposalSnapshot): void {
	setStore(
		produce((state) => {
			const pendingProposals = new Set(snapshot.proposals.map((p) => p.id));
			for (const proposal of snapshot.proposals) {
				state.proposals[proposal.id] = { ...proposal, pending: true };
			}
			for (const logged of Object.values(state.proposals)) {
				if (!pendingProposals.has(logged.id)) logged.pending = false;
			}
			const pendingQuestions = new Set(snapshot.questions.map((q) => q.id));
			for (const question of snapshot.questions) {
				const answeredWith = state.questions[question.id]?.answeredWith;
				state.questions[question.id] = {
					...question,
					pending: true,
					answeredWith,
				};
			}
			for (const logged of Object.values(state.questions)) {
				if (!pendingQuestions.has(logged.id)) logged.pending = false;
			}
		}),
	);
}

let started = false;

export function connectSessions(): void {
	if (started) return;
	started = true;
	const client = wsClient();
	client.subscribe(sessionChannel, {
		onMessage: {
			event: handleWireEvent,
			closed: handleClosed,
		},
		onStatus: (status) => setStore("connected", status === "open"),
	});
	client.subscribe(proposalChannel, {
		onMessage: { snapshot: applyProposalSnapshot },
	});
}

function recordEcho(sessionId: string, text: string): void {
	localEcho.set(sessionId, [...(localEcho.get(sessionId) ?? []), text]);
}

function dropEcho(sessionId: string, text: string): void {
	const echoes = localEcho.get(sessionId) ?? [];
	const index = echoes.lastIndexOf(text);
	if (index !== -1) echoes.splice(index, 1);
}

function migrateChat(oldId: string, newId: string): void {
	if (oldId === newId) return;
	setStore(
		produce((state) => {
			const old = state.chats[oldId];
			if (old === undefined) return;
			const next = state.chats[newId];
			state.chats[newId] = {
				items: [...old.items, ...(next?.items ?? [])],
				busy: next?.busy ?? old.busy,
			};
			delete state.chats[oldId];
		}),
	);
	const echoes = localEcho.get(oldId);
	if (echoes !== undefined) {
		localEcho.set(newId, [...echoes, ...(localEcho.get(newId) ?? [])]);
		localEcho.delete(oldId);
	}
}

export async function sendChatMessage(
	sessionId: string,
	text: string,
): Promise<void> {
	ensureChat(sessionId);
	recordEcho(sessionId, text);
	editItems(sessionId, (items) => {
		items.push({ type: "user", text });
	});
	setStore("chats", sessionId, "busy", true);
	try {
		const result = await api.session.message({ sessionId, prompt: text });
		migrateChat(sessionId, result.sessionId);
	} catch (error) {
		dropEcho(sessionId, text);
		editItems(sessionId, (items) => {
			const index = items.findLastIndex(
				(item) => item.type === "user" && item.text === text,
			);
			if (index !== -1) items.splice(index, 1);
		});
		setStore("chats", sessionId, "busy", false);
		toast.error(
			error instanceof Error ? error.message : "failed to send message",
		);
	}
}

function seedSpawnedChat(sessionId: string, prompt: string): void {
	ensureChat(sessionId);
	editItems(sessionId, (items) => {
		const echoed = items.some(
			(item) => item.type === "user" && item.text === prompt,
		);
		if (!echoed) items.unshift({ type: "user", text: prompt });
	});
}

export async function spawnDefineSession(
	epicId: string,
	prompt: string,
): Promise<string> {
	const result = await api.session.spawn({ kind: "define", epicId, prompt });
	seedSpawnedChat(result.sessionId, prompt);
	return result.sessionId;
}

const REFINE_KICKOFF = "Refine this story into an implementation brief.";

// The `r` entry: the server seeds the session from the card and flips the
// story into refining in the same move.
export async function spawnRefineSession(storyId: string): Promise<string> {
	setStore("refineSpawns", storyId, {});
	try {
		const result = await api.session.spawn({
			kind: "refine",
			storyId,
			prompt: REFINE_KICKOFF,
		});
		seedSpawnedChat(result.sessionId, REFINE_KICKOFF);
		setStore("refineSpawns", storyId, { sessionId: result.sessionId });
		return result.sessionId;
	} catch (error) {
		setStore(
			"refineSpawns",
			produce((spawns) => {
				delete spawns[storyId];
			}),
		);
		toast.error(
			error instanceof Error
				? error.message
				: "failed to start the refine chat",
		);
		throw error;
	}
}

export function refineSpawnFor(
	storyId: string,
): { sessionId?: string } | undefined {
	return store.refineSpawns[storyId];
}

export async function spawnShapeSession(goal: string): Promise<string> {
	const result = await api.session.spawn({ kind: "shape", prompt: goal });
	seedSpawnedChat(result.sessionId, goal);
	return result.sessionId;
}

export async function resolveProposalItem(
	proposalId: string,
	item: number,
	resolution: ProposalResolution,
): Promise<void> {
	try {
		await api.proposal.resolve({ proposalId, item, resolution });
	} catch (error) {
		toast.error(
			error instanceof Error ? error.message : "failed to resolve proposal",
		);
		throw error;
	}
}

export async function acceptAllProposalItems(
	proposal: LoggedProposal,
): Promise<void> {
	for (const [index, item] of proposal.items.entries()) {
		if (item.resolution !== undefined) continue;
		await resolveProposalItem(proposal.id, index, { type: "accept" });
	}
}

export async function answerQuestion(
	question: LoggedQuestion,
	answer: string,
): Promise<void> {
	try {
		await api.proposal.answer({ questionId: question.id, answer });
		setStore("questions", question.id, "answeredWith", answer);
	} catch (error) {
		toast.error(
			error instanceof Error ? error.message : "failed to answer question",
		);
	}
}

export function chatFor(sessionId: string): ChatState {
	return store.chats[sessionId] ?? { items: [], busy: false };
}

// Pending proposals/questions for this session with no anchoring tool call in
// the transcript (the tool call streamed before this client connected); they
// still need widgets, appended after the transcript.
export function unanchoredProposals(
	sessionId: string,
	items: ChatItem[],
): LoggedProposal[] {
	const anchored = new Set(
		items.map((item) => (item.type === "tool" ? item.proposalId : undefined)),
	);
	return Object.values(store.proposals)
		.filter(
			(proposal) =>
				proposal.sessionId === sessionId &&
				proposal.pending &&
				!anchored.has(proposal.id),
		)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function unanchoredQuestions(
	sessionId: string,
	items: ChatItem[],
): LoggedQuestion[] {
	const anchored = new Set(
		items.map((item) => (item.type === "tool" ? item.questionId : undefined)),
	);
	return Object.values(store.questions)
		.filter(
			(question) =>
				question.sessionId === sessionId &&
				question.pending &&
				!anchored.has(question.id),
		)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
