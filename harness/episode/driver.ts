import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter } from "../../src/board/markdown.ts";
import type { GateRecordRound, Story } from "../../src/board/schema.ts";
import { verdictValid } from "../../src/board/transitions.ts";
import type { Proposal } from "../../src/server/mcp/schemas.ts";
import type { SessionKind } from "../../src/sessions/kinds.ts";
import type { GateFlag } from "../../src/shared/gate.ts";
import { readStubLog } from "../stub-claude/log.ts";
import { type StubScript, scriptName } from "../stub-claude/script.ts";
import { type Observer, observe } from "./observer.ts";
import { type RpcCall, rpcClient } from "./rpc.ts";
import { type Scratch, type ScratchOptions, setupScratch } from "./scratch.ts";
import {
	BUILD_INSTRUCTION,
	missingBuildOutputs,
	startOrchestrator,
} from "./server.ts";

const PORT = Number(process.env.HELM_HARNESS_PORT ?? 8797);

export interface SpawnDeclaration {
	kind: SessionKind;
	ordinal: number;
	// `null` for a spawn the orchestrator kills: the stub dies on the signal
	// with its `finish` unreached, so the log carries no completion entry.
	exit: number | null;
	// False when the spawn is expected to find no script for its ordinal.
	claims?: boolean;
}

export interface EpisodeContext {
	base: string;
	scratch: Scratch;
	storyId: string;
	obs: Observer;
	rpc: RpcCall;
	// The brief body on disk, frontmatter stripped.
	body(): string;
	story(): Story;
	say(message: string): void;
	// Stops the orchestrator and starts a fresh one against the same scratch
	// repo and spawn log, then re-attaches the observer and the RPC client.
	restart(): Promise<void>;
	// Holds the server up for an operator; false means stdin closed with
	// nobody there, so the beats after the halt never ran.
	halt(message: string): Promise<boolean>;
}

export interface Episode {
	name: string;
	summary: string;
	scripts: Record<string, StubScript>;
	spawns: SpawnDeclaration[];
	rounds: number;
	// Board fixtures beyond the default single refining story.
	fixture?: ScratchOptions;
	// Stops with the server up and waits for an operator, so a panel that
	// dies with its attempt can be seen.
	halts?: boolean;
	run(ctx: EpisodeContext): Promise<void>;
}

export class EpisodeFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EpisodeFailure";
	}
}

export function assert(ok: boolean, message: string): asserts ok {
	if (!ok) throw new EpisodeFailure(message);
}

export function findStory(ctx: EpisodeContext, storyId = ctx.storyId): Story {
	const story = ctx.obs.board()?.stories.find((each) => each.id === storyId);
	assert(story !== undefined, `no story ${storyId} on the board channel`);
	return story;
}

// The gate record on disk, read through the board channel's story payload.
export function recordedRounds(
	ctx: EpisodeContext,
	storyId = ctx.storyId,
): GateRecordRound[] {
	const story = ctx.obs.board()?.stories.find((each) => each.id === storyId);
	return story?.frontmatter.gate?.rounds ?? [];
}

export async function waitForRecord(
	ctx: EpisodeContext,
	what: string,
	holds: (rounds: GateRecordRound[]) => boolean,
	storyId = ctx.storyId,
): Promise<GateRecordRound[]> {
	const rounds = await ctx.obs.waitFor(what, () => {
		const found = recordedRounds(ctx, storyId);
		return holds(found) ? found : undefined;
	});
	ctx.say(
		`story ${storyId} records ${rounds.length} round(s): ${rounds
			.map(
				(round) =>
					`${round.n} [${round.flags.map((flag) => flag.status).join(",")}]`,
			)
			.join(" ")}`,
	);
	return rounds;
}

export async function spawnRefineChat(
	ctx: EpisodeContext,
	storyId = ctx.storyId,
): Promise<string> {
	const { sessionId } = await ctx.rpc<{ sessionId: string }>("session/spawn", {
		kind: "refine",
		storyId,
		prompt: "Open the refine chat for this story.",
	});
	// `routeFlags` concedes every flag unless the story carries a refine
	// session, and messaging a live one throws SESSION_BUSY, so the gate never
	// starts until this turn has closed.
	await ctx.obs.waitFor(`the refine chat ${sessionId} to close`, () =>
		ctx.obs.closed().find((each) => each.sessionId === sessionId),
	);
	ctx.say(`refine chat ${sessionId} spawned and closed`);
	return sessionId;
}

export async function spawnDefineChat(
	ctx: EpisodeContext,
	epicId: string,
): Promise<string> {
	return await spawnChat(ctx, "define", { epicId });
}

// A shape spawn creates its own thread from the prompt
// (`sessions.ts:559-566`), so nothing on the board has to exist first.
export async function spawnShapeChat(
	ctx: EpisodeContext,
	goal: string,
): Promise<string> {
	return await spawnChat(ctx, "shape", {}, goal);
}

async function spawnChat(
	ctx: EpisodeContext,
	kind: SessionKind,
	attach: Record<string, string>,
	prompt = `Open the ${kind} chat.`,
): Promise<string> {
	const { sessionId } = await ctx.rpc<{ sessionId: string }>("session/spawn", {
		kind,
		...attach,
		prompt,
	});
	await ctx.obs.waitFor(`the ${kind} chat ${sessionId} to close`, () =>
		ctx.obs.closed().find((each) => each.sessionId === sessionId),
	);
	ctx.say(`${kind} chat ${sessionId} spawned and closed`);
	return sessionId;
}

// Accepts every item of the proposal the predicate picks out, once the
// session that made it has closed. Unlike `acceptProposal` it asserts nothing
// about the brief: a propose_stories accept writes new story files instead.
export async function acceptEveryItem(
	ctx: EpisodeContext,
	describe: string,
	match: (proposal: Proposal) => boolean,
): Promise<Proposal> {
	const proposal = await ctx.obs.waitFor(describe, () =>
		ctx.obs.proposals()?.proposals.find(match),
	);
	// The whole closed list, not a slice from a mark: the chat kinds this
	// helper drives spawn once, so any close of that id is the one to wait on.
	await ctx.obs.waitFor(
		`the proposing session ${proposal.sessionId} to close`,
		() =>
			ctx.obs.closed().find((each) => each.sessionId === proposal.sessionId),
	);
	for (let item = 0; item < proposal.items.length; item += 1) {
		await ctx.rpc("proposal/resolve", {
			proposalId: proposal.id,
			item,
			resolution: { type: "accept" },
		});
	}
	ctx.say(`accepted ${proposal.items.length} items of ${describe}`);
	return proposal;
}

export async function moveToReady(
	ctx: EpisodeContext,
	storyId = ctx.storyId,
): Promise<void> {
	const result = await ctx.rpc<{ gating: boolean; phase?: string }>(
		"story/move",
		{ id: storyId, to: "ready" },
	);
	assert(
		result.gating,
		`the move into Ready did not start a gate attempt: ${JSON.stringify(result)}`,
	);
	ctx.say(`move into Ready gating, phase ${String(result.phase)}`);
}

export async function moveStory(
	ctx: EpisodeContext,
	storyId: string,
	to: string,
): Promise<void> {
	await ctx.rpc("story/move", { id: storyId, to });
	await ctx.obs.waitFor(`story ${storyId} to read ${to} on the board`, () =>
		findStory(ctx, storyId).frontmatter.status === to ? to : undefined,
	);
	ctx.say(`story ${storyId} moved to ${to}`);
}

export async function waitForFlag(
	ctx: EpisodeContext,
	title: string,
): Promise<GateFlag> {
	const flag = await ctx.obs.waitFor(
		`the flag "${title}" on the gate channel`,
		() =>
			ctx.obs
				.gate()
				?.attempts.find((attempt) => attempt.storyId === ctx.storyId)
				?.rounds.flatMap((round) => round.flags)
				.find((each) => each.title === title),
	);
	ctx.say(`flag "${flag.title}" raised: ${flag.detail}`);
	return flag;
}

export function flagStatus(
	ctx: EpisodeContext,
	title: string,
): GateFlag | undefined {
	return ctx.obs
		.gate()
		?.attempts.find((attempt) => attempt.storyId === ctx.storyId)
		?.rounds.flatMap((round) => round.flags)
		.find((each) => each.title === title);
}

// Wait for a proposal the predicate picks out, let the session that proposed
// it close, then accept it and assert the brief moved.
export async function acceptProposal(
	ctx: EpisodeContext,
	describe: string,
	match: (proposal: Proposal) => boolean,
): Promise<void> {
	// A refine session closes once per segment and the proposing segment has
	// not started yet, so the mark is taken before the proposal is waited for:
	// taking it after loses the closure whenever the proposal frame and the
	// closed frame land inside the same 50 ms poll.
	const seen = ctx.obs.closed().length;
	const proposal = await ctx.obs.waitFor(describe, () =>
		ctx.obs.proposals()?.proposals.find(match),
	);
	// Resolving a proposal while the session that made it is still live parks
	// the round it enqueues on SESSION_BUSY, a stall no channel carries.
	await ctx.obs.waitFor(
		`the proposing session ${proposal.sessionId} to close`,
		() =>
			ctx.obs
				.closed()
				.slice(seen)
				.find((each) => each.sessionId === proposal.sessionId),
	);
	ctx.say(`proposal ${proposal.id} closed before its resolution`);
	const before = ctx.body();
	await ctx.rpc("proposal/resolve", {
		proposalId: proposal.id,
		item: 0,
		resolution: { type: "accept" },
	});
	assert(
		ctx.body() !== before,
		`accepting ${describe} left the brief byte-identical, so the hash never moved`,
	);
	ctx.say(`accepted ${describe}; the brief body changed`);
}

export async function acceptFix(
	ctx: EpisodeContext,
	resolves: string,
): Promise<void> {
	await acceptProposal(
		ctx,
		`the fix proposal resolving "${resolves}"`,
		(proposal) =>
			proposal.tool === "update_brief" &&
			proposal.items.some((item) => item.payload.resolves === resolves),
	);
}

export async function waitForReady(
	ctx: EpisodeContext,
	storyId = ctx.storyId,
): Promise<Story> {
	const story = await ctx.obs.waitFor(`story ${storyId} to reach Ready`, () => {
		const found = ctx.obs.board()?.stories.find((each) => each.id === storyId);
		return found?.frontmatter.status === "ready" ? found : undefined;
	});
	assert(
		verdictValid(story.frontmatter.gate, story.body),
		"the story reached Ready without a gate verdict for this brief",
	);
	ctx.say(
		`story ${storyId} is Ready with verdict ${story.frontmatter.gate?.brief ?? "?"}`,
	);
	return story;
}

// Episodes author files mid-run too: a script withheld until its beat, and
// the sentinel a `wait` step polls for. Both live in the script directory the
// stub already reads.
export function writeScript(
	scratch: Scratch,
	name: string,
	script: StubScript,
): void {
	writeFileSync(
		join(scratch.scriptsDir, `${name}.json`),
		`${JSON.stringify(script, null, "\t")}\n`,
	);
}

export function releaseSentinel(scratch: Scratch, sentinel: string): void {
	writeFileSync(join(scratch.scriptsDir, sentinel), "");
}

function writeScripts(
	scratch: Scratch,
	scripts: Record<string, StubScript>,
): void {
	for (const [name, script] of Object.entries(scripts)) {
		writeScript(scratch, name, script);
	}
}

function verifySpawnLog(episode: Episode, scratch: Scratch): void {
	const entries = readStubLog(scratch.logPath);
	const starts = entries.filter((entry) => entry.t === "start");
	const exits = entries.filter((entry) => entry.t === "exit");
	for (const [index, declared] of episode.spawns.entries()) {
		const label = `spawn ${index + 1} (${scriptName(declared.kind, declared.ordinal)})`;
		const start = starts[index];
		assert(start !== undefined, `${label} never ran`);
		assert(
			start.kind === declared.kind,
			`${label}: the log resolved kind ${String(start.kind)}`,
		);
		const expected =
			declared.claims === false
				? null
				: scriptName(declared.kind, declared.ordinal);
		assert(
			start.script === expected,
			`${label}: claimed ${String(start.script)}, expected ${String(expected)}${start.failure === undefined ? "" : ` (${start.failure})`}`,
		);
		const exit = exits.find((entry) => entry.pid === start.pid);
		if (declared.exit === null) {
			assert(
				exit === undefined,
				`${label}: declared killed but logged exit ${String(exit?.code)}`,
			);
			continue;
		}
		assert(exit !== undefined, `${label} logged no completion entry`);
		assert(
			exit.code === declared.exit,
			`${label}: exited ${exit.code}, declared ${declared.exit}`,
		);
	}
	assert(
		starts.length === episode.spawns.length,
		`the log carries ${starts.length} spawns, the episode declares ${episode.spawns.length}`,
	);
}

function report(episode: Episode, obs: Observer, scratch: Scratch): void {
	const meter = obs.meter();
	const queue = meter?.queue;
	console.log(
		`meter: ${queue?.running.length ?? 0}/${queue?.cap ?? 0} running, ${queue?.queued.length ?? 0} queued, tokens 5h ${meter?.tokens.fiveHour ?? 0} week ${meter?.tokens.week ?? 0}`,
	);
	console.log(
		`the meter is not the evidence: the stub authors its own usage, so ${scratch.logPath} is what proves ${episode.name} spent no pool tokens`,
	);
}

function halt(
	base: string,
	storyId: string,
	message: string,
): Promise<boolean> {
	console.log(`\nHALT: ${message}`);
	console.log(`the scratch app is live at ${base}, story ${storyId}`);
	console.log("press Enter to continue, or close stdin to stop here\n");
	return new Promise<boolean>((resolve) => {
		const finish = (answered: boolean): void => {
			process.stdin.off("data", onData);
			process.stdin.off("end", onEnd);
			process.stdin.pause();
			resolve(answered);
		};
		const onData = (): void => finish(true);
		const onEnd = (): void => finish(false);
		process.stdin.on("data", onData);
		process.stdin.on("end", onEnd);
		process.stdin.resume();
	});
}

export async function runEpisode(episode: Episode): Promise<boolean> {
	const missing = missingBuildOutputs();
	if (missing.length > 0) {
		console.error(`missing build outputs: ${missing.join(", ")}`);
		console.error(BUILD_INSTRUCTION);
		return false;
	}
	console.log(`\n=== ${episode.name}: ${episode.summary}`);
	const scratch = setupScratch(episode.name, episode.fixture);
	writeScripts(scratch, episode.scripts);
	// The pair is mutable because `restart()` swaps it: teardown and the
	// post-run checks must act on the live orchestrator, never the dead one,
	// or the replacement leaks onto the fixed port.
	let orchestrator = await startOrchestrator(scratch, PORT);
	// Outlives every observer the episode goes through, so a restart cannot
	// discard what the pre-restart half saw.
	const invalid = new Map<string, string>();
	let obs = await observe(orchestrator.base, invalid);
	const ctx: EpisodeContext = {
		base: orchestrator.base,
		scratch,
		storyId: scratch.storyId,
		obs,
		rpc: rpcClient(orchestrator.base),
		body: () =>
			splitFrontmatter(readFileSync(scratch.storyPath, "utf8"))?.body ?? "",
		story: () => findStory(ctx),
		say: (message) => console.log(`  ${message}`),
		restart: async () => {
			obs.close();
			await orchestrator.stop();
			orchestrator = await startOrchestrator(scratch, PORT);
			obs = await observe(orchestrator.base, invalid);
			ctx.base = orchestrator.base;
			ctx.obs = obs;
			ctx.rpc = rpcClient(orchestrator.base);
			await obs.waitFor("the board snapshot after the restart", () =>
				obs.board(),
			);
			console.log("  orchestrator restarted against the same scratch repo");
		},
		halt: (message) => halt(ctx.base, scratch.storyId, message),
	};

	let failure: unknown;
	try {
		await episode.run(ctx);
	} catch (error) {
		failure = error;
	}
	for (const check of [
		() => verifySpawnLog(episode, scratch),
		() =>
			assert(
				obs.maxRounds(scratch.storyId) <= episode.rounds,
				`the gate ran ${obs.maxRounds(scratch.storyId)} rounds, the episode declares ${episode.rounds}`,
			),
		() =>
			assert(
				invalid.size === 0,
				`the board reported invalid files: ${[...invalid]
					.map(([path, message]) => `${path} (${message})`)
					.join("; ")}`,
			),
	]) {
		try {
			check();
		} catch (error) {
			failure ??= error;
		}
	}
	report(episode, obs, scratch);
	obs.close();
	await orchestrator.stop();
	if (failure !== undefined) {
		console.error(`FAIL ${episode.name}: ${String(failure)}`);
		return false;
	}
	console.log(`PASS ${episode.name}`);
	return true;
}
