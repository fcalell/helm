import { readFileSync } from "node:fs";
import { splitFrontmatter } from "../../src/board/markdown.ts";
import { readStubLog } from "../stub-claude/log.ts";
import type { StubScript, StubStep } from "../stub-claude/script.ts";
import {
	NO_SCRIPT_EXIT,
	TOOL_FAILURE_EXIT,
	WAIT_TIMEOUT_EXIT,
} from "../stub-claude/stub.ts";
import {
	acceptEveryItem,
	acceptFix,
	acceptProposal,
	assert,
	type Episode,
	type EpisodeContext,
	findStory,
	flagStatus,
	moveStory,
	moveToReady,
	recordedRounds,
	releaseSentinel,
	spawnDefineChat,
	spawnRefineChat,
	spawnShapeChat,
	waitForFlag,
	waitForReady,
	waitForRecord,
	writeScript,
} from "./driver.ts";
import { RpcError } from "./rpc.ts";
import { READY_GATE } from "./scratch.ts";

const FLAG_ONE = {
	title: "No failure-path criterion",
	detail:
		"Every criterion is happy path; nothing checks what the round does when a spawn dies.",
};
const FLAG_TWO = {
	title: "Blast radius omits the scratch config",
	detail: "The brief never says which files outside the board the work writes.",
};

const FLAG_THREE = {
	title: "The seed of a retried round is unproven",
	detail:
		"Nothing says which text a re-requested round reads: the brief on disk, or the chat that argued about it.",
};
const FLAG_FOUR = {
	title: "No criterion covers the retried round",
	detail: "The brief stops at exhaustion and never grades what comes after it.",
};

const DISMISS_REASON = "the failure path rides its own probe";
const RESEED_REASON = "the retried round has an episode of its own";

// The card fixture's title, in the seed a fresh spawn carries and absent from
// a resume's argv (`scratch.ts` STORY_BODY).
const FIXTURE_TITLE = "Gate harness fixture";
// `prompts.ts` frames the override register with this exact sentence, so a
// dismissed flag never reads as one of the flags above it.
const OVERRIDE_FRAMING =
	"The user has already accepted these risks; do not re-raise them:";

const SILENT_REFINE: StubScript = { kind: "refine", steps: [] };
const SILENT_ADVERSARY: StubScript = { kind: "adversary", steps: [] };

function flagging(
	...flags: Array<{ title: string; detail: string }>
): StubScript {
	return {
		kind: "adversary",
		steps: flags.map((flag) => ({
			t: "call",
			tool: "flag_risk",
			payload: { title: flag.title, detail: flag.detail },
		})),
	};
}

function fixing(
	section: string,
	content: string,
	resolves: string,
): StubScript {
	return {
		kind: "refine",
		steps: [
			{
				t: "call",
				tool: "update_brief",
				payload: { section, content, resolves },
			},
		],
	};
}

function contesting(flag: string, argument: string): StubScript {
	return {
		kind: "refine",
		steps: [{ t: "call", tool: "contest_flag", payload: { flag, argument } }],
	};
}

const FIX_ONE_CONTENT =
	"Everything the episode does not drive, and the spawn-failure path the probes own.";

const FIX_ONE = fixing("Out of scope", FIX_ONE_CONTENT, FLAG_ONE.title);
const FIX_TWO = fixing(
	"Blast radius",
	"The scratch repo only, plus the scratch helm.config.json beside it.",
	FLAG_TWO.title,
);

async function waitForPhase(ctx: EpisodeContext, phase: string): Promise<void> {
	await ctx.obs.waitFor(`the gate to reach ${phase}`, () =>
		ctx.obs.gate()?.attempts.find((attempt) => attempt.storyId === ctx.storyId)
			?.phase === phase
			? phase
			: undefined,
	);
}

function assertRefining(ctx: EpisodeContext, when: string): void {
	assert(
		findStory(ctx).frontmatter.status === "refining",
		`the story left Refining ${when}`,
	);
}

const flagless: Episode = {
	name: "flagless",
	summary: "a clean brief passes the gate in one round",
	scripts: { "refine-1": SILENT_REFINE, "adversary-1": SILENT_ADVERSARY },
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForReady(ctx);
	},
};

const oneFlag: Episode = {
	name: "one-flag",
	summary: "one flagged round, fixed, then a flagless round into Ready",
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": FIX_ONE,
		"adversary-2": SILENT_ADVERSARY,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
		{ kind: "adversary", ordinal: 2, exit: 0 },
	],
	rounds: 2,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		const flag = await waitForFlag(ctx, FLAG_ONE.title);
		assert(
			flag.detail === FLAG_ONE.detail,
			"the flag's detail did not survive the gate channel",
		);
		await waitForPhase(ctx, "refine");
		await acceptFix(ctx, FLAG_ONE.title);
		await ctx.obs.waitFor(`the flag "${FLAG_ONE.title}" to settle fixed`, () =>
			ctx.obs.flagStatuses(ctx.storyId, FLAG_ONE.title).has("fixed")
				? "fixed"
				: undefined,
		);
		await waitForReady(ctx);
	},
};

const contested: Episode = {
	name: "contested",
	summary: "a contested flag halts for the operator, then a dismissal",
	halts: true,
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": contesting(
			FLAG_ONE.title,
			"The failure path has its own probe, so the criterion belongs there.",
		),
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_ONE.title);
		const flag = await ctx.obs.waitFor(
			"the flag to render contested with a counter-argument",
			() => {
				const found = flagStatus(ctx, FLAG_ONE.title);
				return found?.status === "contested" && found.argument !== undefined
					? found
					: undefined;
			},
		);
		await waitForPhase(ctx, "review");
		assertRefining(ctx, "before the operator resolved the flag");
		ctx.say(`counter-argument: ${flag.argument ?? ""}`);
		await waitForRecord(
			ctx,
			"round 1 in the story file",
			(rounds) => rounds.length === 1,
		);
		const answered = await ctx.halt(
			"the drawer shows the review phase line, the contested flag's widget with its counter-argument and the file-driven history box for round 1; the card is still in Refining",
		);
		if (!answered) {
			ctx.say("stdin closed: stopped at the halt, the dismissal never ran");
			return;
		}
		const before = ctx.body();
		await ctx.rpc("gate/resolveFlag", {
			storyId: ctx.storyId,
			flag: FLAG_ONE.title,
			resolution: { type: "dismiss", reason: DISMISS_REASON },
		});
		const story = await waitForReady(ctx);
		assert(
			story.frontmatter.gate?.overrides.some((each) =>
				each.includes(DISMISS_REASON),
			) === true,
			"the dismissal recorded no override on the verdict",
		);
		assert(ctx.body() === before, "the dismissal changed the brief");
	},
};

const exhausted: Episode = {
	name: "exhausted",
	summary: "two flagged rounds, both fixed, the attempt ends exhausted",
	halts: true,
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": FIX_ONE,
		"adversary-2": flagging(FLAG_TWO),
		"refine-3": FIX_TWO,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
		{ kind: "adversary", ordinal: 2, exit: 0 },
		{ kind: "refine", ordinal: 3, exit: 0 },
	],
	rounds: 2,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_ONE.title);
		await acceptFix(ctx, FLAG_ONE.title);
		await waitForFlag(ctx, FLAG_TWO.title);
		await acceptFix(ctx, FLAG_TWO.title);
		const attempt = await ctx.obs.waitFor(
			"the attempt to reach exhausted",
			() => {
				const found = ctx.obs
					.gate()
					?.attempts.find((each) => each.storyId === ctx.storyId);
				return found?.phase === "exhausted" ? found : undefined;
			},
		);
		assert(
			attempt.rounds.length === 2,
			`the exhausted attempt carries ${attempt.rounds.length} rounds`,
		);
		assertRefining(ctx, "before the attempt was dropped");
		await waitForRecord(
			ctx,
			"both rounds in the story file",
			(rounds) => rounds.length === 2,
		);
		await ctx.halt(
			'the gate panel shows the exhausted phase line with no round count, both rounds in the file-driven history box, the "Move the card to Ready…" line and no flag widget; the card carries the gate badge',
		);
	},
};

const exitAfterInit: Episode = {
	name: "probe-exit-after-init",
	summary: "a stub dying after init is invisible to the gate",
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": { kind: "adversary", steps: [{ t: "exit", code: 3 }] },
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 3 },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForReady(ctx);
		ctx.say(
			"the adversary died 3 after init and the gate still recorded a pass: only the declared exit code catches it",
		);
	},
};

const missingScript: Episode = {
	name: "probe-missing-script",
	summary: "a configured directory with no script kills the spawn before init",
	scripts: { "refine-1": SILENT_REFINE },
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: NO_SCRIPT_EXIT, claims: false },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		const notice = await ctx.obs.waitFor(
			"the gate-aborted notice on the board channel",
			() => ctx.obs.notices().find((each) => each.kind === "gate-aborted"),
		);
		ctx.say(`gate aborted: ${notice.message}`);
		await ctx.obs.waitFor(
			"the dispatcher slot to vacate on the meter channel",
			() => (ctx.obs.meter()?.queue.running.length === 0 ? true : undefined),
		);
		assertRefining(ctx, "after a spawn that never reached init");
		assert(
			(ctx.obs.gate()?.attempts.length ?? 0) === 0,
			"the aborted attempt is still on the gate channel",
		);
		await waitForRecord(
			ctx,
			"the interrupted round in the story file",
			(rounds) => rounds.length === 1 && rounds[0]?.n === 1,
		);
		assertRefining(ctx, "after the interrupted round was recorded");
	},
};

const invalidPayload: Episode = {
	name: "probe-invalid-payload",
	summary: "a rejected flag_risk payload fails the spawn without a retry",
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": {
			kind: "adversary",
			steps: [
				{ t: "call", tool: "flag_risk", payload: { title: "", detail: "" } },
			],
		},
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: TOOL_FAILURE_EXIT },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForReady(ctx);
		const refusals = readStubLog(ctx.scratch.logPath).filter(
			(entry) => entry.t === "refusal",
		);
		const fatal = refusals.find((entry) =>
			entry.text.includes("MCP error -32602"),
		);
		assert(fatal !== undefined, "no -32602 refusal in the log");
		assert(!fatal.retrying, "the stub retried a payload rejection");
		assert(
			refusals.length === 1,
			`the stub logged ${refusals.length} refusals for one rejected call`,
		);
		ctx.say(`fatal refusal: ${fatal.text.slice(0, 120)}`);
	},
};

const concession: Episode = {
	name: "probe-concession",
	summary: "a refine turn that answers nothing auto-contests its flags",
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": SILENT_REFINE,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_ONE.title);
		const conceded = await ctx.obs.waitFor(
			"the unanswered flag to auto-contest",
			() => {
				const found = flagStatus(ctx, FLAG_ONE.title);
				return found?.status === "contested" ? found : undefined;
			},
		);
		assert(
			conceded.argument === undefined,
			"the conceded flag carries a counter-argument",
		);
		await waitForPhase(ctx, "review");
		assertRefining(ctx, "after the round conceded");
	},
};

const SECOND_ID = "001-02";

const FIXTURE_OVERRIDES = [
	`${FLAG_ONE.title}: the failure path rides its own probe, so the criterion belongs there`,
	`${FLAG_TWO.title}: the scratch config is named in the approach, so the blast radius stands`,
];

const FIXTURE_ROUNDS = [
	{ n: 1, flags: [{ title: FLAG_ONE.title, status: "dismissed" as const }] },
	{ n: 2, flags: [{ title: FLAG_TWO.title, status: "fixed" as const }] },
];

function frontmatterLines(path: string): string[] {
	return (splitFrontmatter(readFileSync(path, "utf8"))?.head ?? "").split("\n");
}

// A conceded round has settled: its refine turn spawned and closed, and the
// record carries the flag at its final status.
async function waitForSettledRound(
	ctx: EpisodeContext,
	title: string,
	rounds: number,
): Promise<void> {
	await waitForPhase(ctx, "review");
	await waitForRecord(
		ctx,
		`round ${rounds} recorded with "${title}" contested`,
		(recorded) =>
			recorded.length === rounds &&
			recorded[rounds - 1]?.flags.some(
				(flag) => flag.title === title && flag.status === "contested",
			) === true,
	);
}

const historyRestart: Episode = {
	name: "gate-history-restart",
	summary: "a recorded round survives a restart and the next one appends to it",
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": SILENT_REFINE,
		"adversary-2": flagging(FLAG_TWO),
		"refine-3": SILENT_REFINE,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
		{ kind: "adversary", ordinal: 2, exit: 0 },
		{ kind: "refine", ordinal: 3, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_ONE.title);
		await waitForSettledRound(ctx, FLAG_ONE.title, 1);
		await ctx.restart();
		assertRefining(ctx, "across the restart");
		assert(
			(ctx.obs.gate()?.attempts.length ?? 0) === 0,
			"the restarted orchestrator still holds a gate attempt",
		);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_TWO.title);
		await waitForSettledRound(ctx, FLAG_TWO.title, 2);
		const both = recordedRounds(ctx);
		assert(
			both[0]?.n === 1 && both[1]?.n === 2,
			`the rounds are numbered ${both.map((round) => round.n).join(",")}`,
		);
		assert(
			both[0]?.flags[0]?.title === FLAG_ONE.title &&
				both[1]?.flags[0]?.title === FLAG_TWO.title,
			"the second attempt overwrote the first attempt's round",
		);
	},
};

const historyCleared: Episode = {
	name: "gate-history-cleared",
	summary: "every exit out of Refining clears the record and its attempt",
	fixture: {
		stories: [{ id: SECOND_ID, gate: { rounds: FIXTURE_ROUNDS } }],
	},
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": SILENT_REFINE,
		"adversary-2": flagging(FLAG_TWO),
		"refine-3": SILENT_REFINE,
		"adversary-3": SILENT_ADVERSARY,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
		{ kind: "adversary", ordinal: 2, exit: 0 },
		{ kind: "refine", ordinal: 3, exit: 0 },
		{ kind: "adversary", ordinal: 3, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_ONE.title);
		await waitForSettledRound(ctx, FLAG_ONE.title, 1);
		await moveStory(ctx, ctx.storyId, "backlog");
		await waitForRecord(
			ctx,
			"the record cleared by the drag to Backlog",
			(rounds) => rounds.length === 0,
		);
		assert(
			(ctx.obs.gate()?.attempts.length ?? 0) === 0,
			"the drag left the gate attempt alive, so it can restore the record",
		);
		await moveStory(ctx, ctx.storyId, "refining");
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_TWO.title);
		await waitForSettledRound(ctx, FLAG_TWO.title, 1);
		const restarted = recordedRounds(ctx);
		assert(
			restarted[0]?.n === 1 && restarted[0]?.flags[0]?.title === FLAG_TWO.title,
			"the cleared record came back instead of starting over",
		);
		await moveToReady(ctx, SECOND_ID);
		await waitForReady(ctx, SECOND_ID);
		assert(
			recordedRounds(ctx, SECOND_ID).length === 0,
			"the pass left the round record on a story now in Ready",
		);
		assert(
			!frontmatterLines(ctx.scratch.storyPaths[SECOND_ID] ?? "").some((line) =>
				line.includes("rounds"),
			),
			"the passed story's gate block still carries a rounds key",
		);
	},
};

const historyBlockStyle: Episode = {
	name: "gate-history-block-style",
	summary: "a record with lists serializes as a block map, one entry per line",
	fixture: {
		gate: { overrides: FIXTURE_OVERRIDES, rounds: FIXTURE_ROUNDS },
	},
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": SILENT_REFINE,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_ONE.title);
		await waitForSettledRound(ctx, FLAG_ONE.title, 3);
		const rounds = recordedRounds(ctx);
		assert(
			rounds.map((round) => round.n).join(",") === "1,2,3",
			`the rounds are numbered ${rounds.map((round) => round.n).join(",")}`,
		);
		assert(
			rounds[0]?.flags[0]?.status === "dismissed" &&
				rounds[1]?.flags[0]?.status === "fixed",
			"the live round rewrote the fixture's rounds",
		);
		const lines = frontmatterLines(ctx.scratch.storyPath);
		assert(
			lines.includes("gate:"),
			`the gate block stayed flow-styled:\n${lines.join("\n")}`,
		);
		for (const override of FIXTURE_OVERRIDES) {
			assert(
				lines.filter((line) => line.includes(override)).length === 1,
				`override "${override.slice(0, 30)}…" is not on a line of its own`,
			);
		}
		assert(
			!lines.some((line) =>
				FIXTURE_OVERRIDES.every((override) => line.includes(override)),
			),
			"both overrides share one line, so the line grows with the list",
		);
		assert(
			lines.filter((line) => /^\s+- n: \d+$/.test(line)).length === 3,
			"the rounds are not a block sequence of block maps",
		);
		assert(
			!lines.some(
				(line) =>
					line.includes(FLAG_ONE.title) && line.includes(FLAG_TWO.title),
			),
			"two flags share one line, so the line grows with the list",
		);
		ctx.say("every list under `gate` renders one entry per line");
	},
};

const historyCold: Episode = {
	name: "gate-history-cold",
	summary: "a cold orchestrator renders the record from the file alone",
	halts: true,
	fixture: {
		gate: {
			rounds: [
				...FIXTURE_ROUNDS,
				{
					n: 3,
					flags: [
						{ title: FLAG_ONE.title, status: "contested" },
						{ title: FLAG_TWO.title, status: "accepted" },
					],
				},
			],
		},
		stories: [
			{
				id: SECOND_ID,
				status: "ready",
				gate: {
					rounds: [
						...FIXTURE_ROUNDS,
						{
							n: 3,
							flags: [
								{ title: FLAG_ONE.title, status: "contested" },
								{ title: FLAG_TWO.title, status: "accepted" },
							],
						},
					],
				},
			},
		],
	},
	scripts: {},
	spawns: [],
	rounds: 0,
	run: async (ctx) => {
		assert(
			(ctx.obs.gate()?.attempts.length ?? 0) === 0,
			"a freshly started orchestrator already holds a gate attempt",
		);
		await waitForRecord(
			ctx,
			"the refining story's three fixture rounds",
			(rounds) => rounds.length === 3,
		);
		await waitForRecord(
			ctx,
			"the Ready story's identical three rounds",
			(rounds) => rounds.length === 3,
			SECOND_ID,
		);
		await ctx.halt(
			`the drawer for ${ctx.storyId} shows all three rounds with their resolutions and its card carries the "gate spent" badge, while ${SECOND_ID} in Ready shows neither`,
		);
	},
};

// A refine turn that holds itself open until the episode writes the sentinel:
// the only way a second spawn arrives while the first is still live.
function holding(sentinel: string, timeoutMs?: number): StubScript {
	return {
		kind: "refine",
		steps: [
			{
				t: "wait",
				sentinel,
				...(timeoutMs === undefined ? {} : { timeoutMs }),
			},
		],
	};
}

function stubStarts(ctx: EpisodeContext) {
	return readStubLog(ctx.scratch.logPath).filter(
		(entry) => entry.t === "start",
	);
}

async function waitForExits(ctx: EpisodeContext, count: number): Promise<void> {
	await ctx.obs.waitFor(`${count} spawns to log their exit`, () =>
		readStubLog(ctx.scratch.logPath).filter((entry) => entry.t === "exit")
			.length >= count
			? count
			: undefined,
	);
}

async function spawnRefine(
	ctx: EpisodeContext,
	prompt: string,
): Promise<string> {
	const { sessionId } = await ctx.rpc<{ sessionId: string }>("session/spawn", {
		kind: "refine",
		storyId: ctx.storyId,
		prompt,
	});
	return sessionId;
}

async function refusal(
	what: string,
	call: Promise<unknown>,
): Promise<RpcError> {
	let caught: unknown;
	try {
		await call;
	} catch (error) {
		caught = error;
	}
	assert(
		caught instanceof RpcError,
		`${what} did not fail with an RPC error: ${String(caught)}`,
	);
	assert(caught.status === 409, `${what} returned ${caught.status}, not 409`);
	assert(
		caught.body.includes("SESSION_BUSY"),
		`${what} carries no SESSION_BUSY: ${caught.body}`,
	);
	return caught;
}

const GUARD_HOLD = "guard-refine-hold";

const PROPOSING_REFINE: StubScript = {
	kind: "refine",
	steps: [
		{
			t: "call",
			tool: "update_brief",
			payload: {
				section: "Out of scope",
				content: "Everything the guard episode does not drive.",
			},
		},
	],
};

const refineTurnGuard: Episode = {
	name: "refine-turn-guard",
	summary: "a live refine turn refuses a second spawn and holds a resolution",
	scripts: {
		"refine-1": PROPOSING_REFINE,
		"refine-2": holding(GUARD_HOLD),
		"refine-3": SILENT_REFINE,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
		{ kind: "refine", ordinal: 3, exit: 0 },
	],
	rounds: 0,
	run: async (ctx) => {
		const proposing = await spawnRefineChat(ctx);
		const proposal = await ctx.obs.waitFor("the brief proposal", () =>
			ctx.obs
				.proposals()
				?.proposals.find((each) => each.tool === "update_brief"),
		);
		const live = await spawnRefine(ctx, "Open a second refine chat.");
		assert(
			live !== proposing,
			"the fresh spawn kept the proposal turn's id, so nothing diverged",
		);
		await ctx.obs.waitFor(
			`sessions.refine to read the live turn ${live}`,
			() =>
				findStory(ctx).frontmatter.sessions.refine === live ? live : undefined,
		);
		const spawned = stubStarts(ctx).length;
		await refusal(
			"the second refine spawn",
			ctx.rpc("session/spawn", {
				kind: "refine",
				storyId: ctx.storyId,
				prompt: "Open a third refine chat while the second holds.",
			}),
		);
		assert(
			stubStarts(ctx).length === spawned,
			"the refused spawn still started a process",
		);
		assert(
			findStory(ctx).frontmatter.sessions.refine === live,
			"the refused spawn overwrote sessions.refine",
		);
		ctx.say(`the second spawn was refused 409 while ${live} holds the story`);
		await ctx.rpc("proposal/resolve", {
			proposalId: proposal.id,
			item: 0,
			resolution: {
				type: "reject",
				reason: "the guard episode rejects it to force an outcome resume",
			},
		});
		assert(
			stubStarts(ctx).length === spawned,
			"the resolution's resume spawned a turn while the story was busy",
		);
		ctx.say("the rejection resolved during the live turn and was held");
		releaseSentinel(ctx.scratch, GUARD_HOLD);
		const drained = await ctx.obs.waitFor(
			"the drained resume to spawn refine-3",
			() => stubStarts(ctx).find((entry) => entry.script === "refine-3.json"),
		);
		assert(
			drained.parsed.resume === proposing,
			`the drained resume carried ${String(drained.parsed.resume)}, not the proposal turn ${proposing}`,
		);
		ctx.say(`the held rejection resumed ${proposing} on the live turn's close`);
		await waitForExits(ctx, 3);
	},
};

const PARK_ADVERSARY_HOLD = "park-adversary-hold";
const PARK_REFINE_HOLD = "park-refine-hold";

const refineTurnPark: Episode = {
	name: "refine-turn-park",
	summary: "flags parked on a busy story route on the next close",
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": {
			kind: "adversary",
			steps: [
				{
					t: "call",
					tool: "flag_risk",
					payload: { title: FLAG_ONE.title, detail: FLAG_ONE.detail },
				},
				{ t: "wait", sentinel: PARK_ADVERSARY_HOLD },
			],
		},
		"refine-2": holding(PARK_REFINE_HOLD),
		"refine-3": SILENT_REFINE,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
		{ kind: "refine", ordinal: 3, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		const chat = await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_ONE.title);
		await ctx.rpc("session/message", {
			sessionId: chat,
			prompt: "Hold this chat open while the adversary finishes.",
		});
		const spawned = stubStarts(ctx).length;
		ctx.say(`refine turn ${chat} is live with the adversary still holding`);
		releaseSentinel(ctx.scratch, PARK_ADVERSARY_HOLD);
		await waitForPhase(ctx, "refine");
		assert(
			stubStarts(ctx).length === spawned,
			"the flags route reached a spawn instead of parking",
		);
		assert(
			flagStatus(ctx, FLAG_ONE.title)?.status === "open",
			"the parked round conceded its flag",
		);
		ctx.say("the flags parked: phase refine, flag open, no spawn");
		releaseSentinel(ctx.scratch, PARK_REFINE_HOLD);
		const retried = await ctx.obs.waitFor(
			"the chained retry to resume the refine session",
			() => stubStarts(ctx).find((entry) => entry.script === "refine-3.json"),
		);
		assert(
			retried.parsed.resume === chat,
			`the retry resumed ${String(retried.parsed.resume)}, not ${chat}`,
		);
		assert(
			retried.parsed.prompt?.includes("ready-gate adversary") === true,
			`the retry carried something other than the flags prompt: ${String(retried.parsed.prompt)}`,
		);
		ctx.say("the close healed the park: the retry carried the flags prompt");
		await waitForPhase(ctx, "review");
		assert(
			flagStatus(ctx, FLAG_ONE.title)?.status === "contested",
			"the unanswered retry left the flag unsettled",
		);
		await waitForRecord(
			ctx,
			"round 1 recorded with the flag contested",
			(rounds) =>
				rounds.length === 1 &&
				rounds[0]?.flags.some(
					(flag) =>
						flag.title === FLAG_ONE.title && flag.status === "contested",
				) === true,
		);
		assertRefining(ctx, "after the parked round settled");
	},
};

const NEVER_RELEASED = "failure-release-never-written";
const TIMEOUT_WAIT_MS = 500;

const refineTurnFailureRelease: Episode = {
	name: "refine-turn-failure-release",
	summary: "a pre-init death and a timed-out turn both free the story",
	scripts: { "refine-2": SILENT_REFINE },
	spawns: [
		{ kind: "refine", ordinal: 1, exit: NO_SCRIPT_EXIT, claims: false },
		{ kind: "refine", ordinal: 1, exit: WAIT_TIMEOUT_EXIT },
		{ kind: "refine", ordinal: 2, exit: 0 },
	],
	rounds: 0,
	run: async (ctx) => {
		let caught: unknown;
		try {
			await spawnRefine(ctx, "Open the refine chat with no script to claim.");
		} catch (error) {
			caught = error;
		}
		assert(
			caught instanceof RpcError,
			`the scriptless spawn did not fail: ${String(caught)}`,
		);
		ctx.say(
			`the scriptless spawn died before init: ${caught.body.slice(0, 90)}`,
		);
		writeScript(ctx.scratch, "refine-1", {
			kind: "refine",
			steps: [
				{ t: "wait", sentinel: NEVER_RELEASED, timeoutMs: TIMEOUT_WAIT_MS },
			],
		});
		const timing = await spawnRefine(
			ctx,
			"Open the refine chat that waits for a sentinel nobody writes.",
		);
		ctx.say(`the story took ${timing} straight after the failed spawn`);
		const closed = await ctx.obs.waitFor("the waiting turn to time out", () =>
			ctx.obs.closed().find((each) => each.sessionId === timing),
		);
		assert(
			closed.exitCode === WAIT_TIMEOUT_EXIT,
			`the waiting turn exited ${String(closed.exitCode)}, not ${WAIT_TIMEOUT_EXIT}`,
		);
		const after = await spawnRefine(
			ctx,
			"Open the refine chat after the timed-out one.",
		);
		ctx.say(`the story took ${after} after the timeout close`);
		await waitForExits(ctx, 3);
	},
};

const LIVE_HOLD = "live-refine-hold";
const OPERATOR_WAIT_MS = 600_000;

const refineTurnLive: Episode = {
	name: "refine-turn-live",
	summary: "a live refine turn refuses the drawer's next message",
	halts: true,
	scripts: { "refine-1": holding(LIVE_HOLD, OPERATOR_WAIT_MS) },
	spawns: [{ kind: "refine", ordinal: 1, exit: 0 }],
	rounds: 0,
	run: async (ctx) => {
		const live = await spawnRefine(ctx, "Open the refine chat and hold it.");
		ctx.say(`refine turn ${live} is live and holding`);
		await ctx.halt(
			"the drawer's chat for this story is mid-turn: reload it, send a message and the send is refused with a SESSION_BUSY toast, the echoed line disappears from the transcript, and the composer still takes input",
		);
		releaseSentinel(ctx.scratch, LIVE_HOLD);
		await ctx.obs.waitFor("the held turn to close", () =>
			ctx.obs.closed().find((each) => each.sessionId === live),
		);
		ctx.say("the sentinel closed the held turn cleanly");
	},
};

async function waitForRefineSession(
	ctx: EpisodeContext,
	sessionId: string,
): Promise<void> {
	await ctx.obs.waitFor(`sessions.refine to read ${sessionId}`, () =>
		findStory(ctx).frontmatter.sessions.refine === sessionId
			? sessionId
			: undefined,
	);
}

// The two automatic rounds a retry needs spent: each flags and is fixed, so
// the second one leaves the attempt with a moved brief hash.
async function spendTwoRounds(ctx: EpisodeContext): Promise<void> {
	await waitForFlag(ctx, FLAG_ONE.title);
	await acceptFix(ctx, FLAG_ONE.title);
	await waitForFlag(ctx, FLAG_TWO.title);
	await acceptFix(ctx, FLAG_TWO.title);
}

const reseedRetry: Episode = {
	name: "gate-reseed-retry",
	summary: "a retried exhausted attempt routes its round to a fresh session",
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": FIX_ONE,
		"adversary-2": flagging(FLAG_TWO, FLAG_THREE),
		"refine-3": FIX_TWO,
		"adversary-3": flagging(FLAG_FOUR),
		"refine-4": SILENT_REFINE,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
		{ kind: "adversary", ordinal: 2, exit: 0 },
		{ kind: "refine", ordinal: 3, exit: 0 },
		{ kind: "adversary", ordinal: 3, exit: 0 },
		{ kind: "refine", ordinal: 4, exit: 0 },
	],
	rounds: 3,
	run: async (ctx) => {
		const chat = await spawnRefineChat(ctx);
		await moveToReady(ctx);
		await spendTwoRounds(ctx);
		await ctx.obs.waitFor(`the flag "${FLAG_THREE.title}" to concede`, () =>
			flagStatus(ctx, FLAG_THREE.title)?.status === "contested"
				? "contested"
				: undefined,
		);
		await ctx.rpc("gate/resolveFlag", {
			storyId: ctx.storyId,
			flag: FLAG_THREE.title,
			resolution: { type: "dismiss", reason: RESEED_REASON },
		});
		await waitForPhase(ctx, "exhausted");
		const attempt = ctx.obs
			.gate()
			?.attempts.find((each) => each.storyId === ctx.storyId);
		assert(
			attempt?.rounds.length === 2,
			`the exhausted attempt carries ${String(attempt?.rounds.length)} rounds`,
		);
		assert(
			attempt.overrides.some((each) => each.includes(RESEED_REASON)),
			"the dismissal left no override on the exhausted attempt",
		);
		await waitForRecord(
			ctx,
			"both spent rounds in the story file",
			(rounds) => rounds.length === 2,
		);

		await moveToReady(ctx);
		const fresh = await ctx.obs.waitFor("the reseeded refine spawn", () =>
			stubStarts(ctx).find((entry) => entry.script === "refine-4.json"),
		);
		assert(
			fresh.parsed.resume === undefined,
			`the retried round resumed ${String(fresh.parsed.resume)} instead of spawning fresh`,
		);
		const seed = fresh.parsed.systemPrompt ?? "";
		assert(
			seed.includes(FIXTURE_TITLE),
			"the fresh spawn carries no story card in its system prompt",
		);
		assert(
			seed.includes(FIX_ONE_CONTENT),
			"the fresh spawn's seed predates round 1's fix, so it is not the story file on disk",
		);
		const prompt = fresh.parsed.prompt ?? "";
		assert(
			prompt.includes(FLAG_FOUR.title),
			`the fresh spawn's message carries no round 3 flag: ${prompt}`,
		);
		assert(
			prompt.includes(OVERRIDE_FRAMING),
			`the register rides the flag list unframed: ${prompt}`,
		);
		assert(
			prompt.includes(FLAG_THREE.title) && prompt.includes(RESEED_REASON),
			`the dismissed flag's title and reason are missing from the register: ${prompt}`,
		);
		ctx.say(
			"the retried round spawned fresh with the card seed and the register",
		);
		for (const name of ["refine-2.json", "refine-3.json"]) {
			const resumed = stubStarts(ctx).find((entry) => entry.script === name);
			assert(
				resumed?.parsed.resume === chat,
				`${name} carried ${String(resumed?.parsed.resume)}, not the chat ${chat}`,
			);
		}
		const rebound = await ctx.obs.waitFor(
			"sessions.refine to move off the spent chat",
			() => {
				const found = findStory(ctx).frontmatter.sessions.refine;
				return found !== undefined && found !== chat ? found : undefined;
			},
		);
		await ctx.obs.waitFor(
			`a closed frame for the reseeded session ${rebound}`,
			() => ctx.obs.closed().find((each) => each.sessionId === rebound),
		);
		ctx.say(`the story's refine session moved from ${chat} to ${rebound}`);
		await waitForPhase(ctx, "review");
		await waitForRecord(
			ctx,
			"round 3 recorded with its flag contested",
			(rounds) =>
				rounds.length === 3 &&
				rounds[2]?.flags.some(
					(flag) =>
						flag.title === FLAG_FOUR.title && flag.status === "contested",
				) === true,
		);
	},
};

const reseedNotOnRecord: Episode = {
	name: "gate-reseed-not-on-record",
	summary: "a spent record with no attempt in memory resumes the refine chat",
	fixture: { gate: { rounds: FIXTURE_ROUNDS } },
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": SILENT_REFINE,
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		const chat = await spawnRefineChat(ctx);
		await waitForRefineSession(ctx, chat);
		assert(
			recordedRounds(ctx).length === 2,
			`the fixture story records ${recordedRounds(ctx).length} rounds, not the two a spent attempt leaves`,
		);
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_ONE.title);
		const routed = await ctx.obs.waitFor("the round's refine spawn", () =>
			stubStarts(ctx).find((entry) => entry.script === "refine-2.json"),
		);
		assert(
			routed.parsed.resume === chat,
			`the round spawned fresh (resume ${String(routed.parsed.resume)}) on a story whose only exhaustion evidence is its record`,
		);
		assert(
			routed.parsed.systemPrompt?.includes(FIXTURE_TITLE) !== true,
			"the round's spawn carries the card seed, so it reseeded instead of resuming",
		);
		assert(
			findStory(ctx).frontmatter.sessions.refine === chat,
			"sessions.refine moved off the chat the round resumed",
		);
		ctx.say(`the round resumed ${chat}: two recorded rounds trigger nothing`);
		await waitForSettledRound(ctx, FLAG_ONE.title, 3);
	},
};

const RESEED_ADVERSARY_HOLD = "reseed-adversary-hold";
const RESEED_REFINE_HOLD = "reseed-refine-hold";

const reseedPark: Episode = {
	name: "gate-reseed-park",
	summary: "a reseed parked on a busy story spawns fresh on the next close",
	scripts: {
		"refine-1": SILENT_REFINE,
		"adversary-1": flagging(FLAG_ONE),
		"refine-2": FIX_ONE,
		"adversary-2": flagging(FLAG_TWO),
		"refine-3": FIX_TWO,
		"adversary-3": {
			kind: "adversary",
			steps: [
				{
					t: "call",
					tool: "flag_risk",
					payload: { title: FLAG_FOUR.title, detail: FLAG_FOUR.detail },
				},
				{ t: "wait", sentinel: RESEED_ADVERSARY_HOLD },
			],
		},
		"refine-4": holding(RESEED_REFINE_HOLD),
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
		{ kind: "adversary", ordinal: 2, exit: 0 },
		{ kind: "refine", ordinal: 3, exit: 0 },
		{ kind: "adversary", ordinal: 3, exit: 0 },
		{ kind: "refine", ordinal: 4, exit: 0 },
		{ kind: "refine", ordinal: 5, exit: NO_SCRIPT_EXIT, claims: false },
	],
	rounds: 3,
	run: async (ctx) => {
		const chat = await spawnRefineChat(ctx);
		await waitForRefineSession(ctx, chat);
		await moveToReady(ctx);
		await spendTwoRounds(ctx);
		await waitForPhase(ctx, "exhausted");
		await moveToReady(ctx);
		await waitForFlag(ctx, FLAG_FOUR.title);
		await ctx.rpc("session/message", {
			sessionId: chat,
			prompt: "Hold this chat open while the adversary finishes.",
		});
		const spawned = stubStarts(ctx).length;
		ctx.say(`refine turn ${chat} is live with the adversary still holding`);
		releaseSentinel(ctx.scratch, RESEED_ADVERSARY_HOLD);
		await waitForPhase(ctx, "refine");
		assert(
			stubStarts(ctx).length === spawned,
			"the reseed reached a spawn instead of parking",
		);
		assert(
			flagStatus(ctx, FLAG_FOUR.title)?.status === "open",
			"the parked round conceded its flag",
		);
		ctx.say("the reseed parked: phase refine, flag open, no spawn");
		releaseSentinel(ctx.scratch, RESEED_REFINE_HOLD);
		const retried = await ctx.obs.waitFor(
			"the chained retry to spawn its own turn",
			() =>
				stubStarts(ctx)
					.slice(spawned)
					.find((entry) => entry.kind === "refine"),
		);
		assert(
			retried.parsed.resume === undefined,
			`the healed park resumed ${String(retried.parsed.resume)} instead of spawning fresh`,
		);
		ctx.say(
			"the close healed the park with a fresh spawn, and it found no script",
		);
		await waitForPhase(ctx, "review");
		const flag = flagStatus(ctx, FLAG_FOUR.title);
		assert(
			flag?.status === "contested" && flag.argument === undefined,
			`the failed reseed left the flag ${String(flag?.status)}`,
		);
		assert(
			findStory(ctx).frontmatter.sessions.refine === chat,
			"the failed reseed moved sessions.refine off the pre-retry chat",
		);
		await waitForRecord(
			ctx,
			"round 3 recorded with its flag contested",
			(rounds) =>
				rounds.length === 3 &&
				rounds[2]?.flags.some(
					(flag) =>
						flag.title === FLAG_FOUR.title && flag.status === "contested",
				) === true,
		);
		assertRefining(ctx, "after the failed reseed settled");
	},
};

// Every checklist item here wraps, so the mode tag lands on a continuation
// line and the gate only passes once the reader folds them in.
const WRAPPED_BODY = [
	"# Wrapped fixture",
	"",
	"## Goal",
	"",
	"Give an episode a brief whose checklist items wrap the way the repo's own",
	"briefs wrap.",
	"",
	"## Approach",
	"",
	"Hold every section the ready gate checks, and no gate verdict.",
	"",
	"## Blast radius",
	"",
	"The scratch repo only.",
	"",
	"## Acceptance criteria",
	"",
	"- [ ] The story reaches Ready with a recorded gate verdict, and its text",
	"      folds across both of these lines (file)",
	"- [ ] A second criterion wraps the same way and keeps a mode of its own",
	"      (command)",
	"",
	"## Out of scope",
	"",
	"Everything the episode does not drive.",
	"",
	"## Open questions",
	"",
	"- [x] Does a blank line end an item?",
	"",
	"      This indented line follows a blank one.",
	"- [x] Does an unindented line end an item?",
	"unindented text",
	"- [x] Does a nested item end its parent?",
	"  - [x] A nested child.",
	"",
].join("\n");

const WRAPPED_CRITERIA = [
	"The story reaches Ready with a recorded gate verdict, and its text folds across both of these lines",
	"A second criterion wraps the same way and keeps a mode of its own",
];

const WRAPPED_QUESTION =
	"Does the tool match an open question whose text runs past one line, and past a second one too?";

const WRAPPED_ANSWER = "It does, once the reader folds the continuations in.";

const QUESTION_BODY = [
	"# Wrapped question fixture",
	"",
	"## Goal",
	"",
	"Give an episode an open question whose text wraps across three lines.",
	"",
	"## Approach",
	"",
	"Leave the question open, so the board tool has something to resolve.",
	"",
	"## Blast radius",
	"",
	"The scratch repo only.",
	"",
	"## Acceptance criteria",
	"",
	"- [ ] The question is checked off and its answer folded (file)",
	"",
	"## Out of scope",
	"",
	"Everything the episode does not drive.",
	"",
	"## Open questions",
	"",
	"- [ ] Does the tool match an open question whose text runs past one line,",
	"      and past a second one",
	"      too?",
	"",
].join("\n");

const wrappedBrief: Episode = {
	name: "wrapped-brief",
	summary: "a brief whose criteria wrap keeps their modes and passes the gate",
	fixture: { body: WRAPPED_BODY },
	scripts: { "refine-1": SILENT_REFINE, "adversary-1": SILENT_ADVERSARY },
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "adversary", ordinal: 1, exit: 0 },
	],
	rounds: 1,
	run: async (ctx) => {
		await spawnRefineChat(ctx);
		const criteria = findStory(ctx).brief.criteria;
		assert(
			criteria.length === WRAPPED_CRITERIA.length,
			`${criteria.length} criteria parsed, expected ${WRAPPED_CRITERIA.length}`,
		);
		for (const [at, text] of WRAPPED_CRITERIA.entries()) {
			assert(
				criteria[at]?.text === text,
				`criterion ${at + 1} parsed as "${criteria[at]?.text}"`,
			);
		}
		assert(
			criteria[0]?.mode === "file" && criteria[1]?.mode === "command",
			"a wrapped criterion lost the mode tag on its continuation line",
		);
		const questions = findStory(ctx).brief.openQuestions;
		assert(
			questions.length === 4,
			`${questions.length} open questions parsed, expected 4`,
		);
		assert(
			questions[0]?.text === "Does a blank line end an item?" &&
				questions[1]?.text === "Does an unindented line end an item?" &&
				questions[2]?.text === "Does a nested item end its parent?" &&
				questions[3]?.text === "A nested child.",
			"a blank line, an unindented line or a nested item folded into its parent",
		);
		await moveToReady(ctx);
		await waitForReady(ctx);
	},
};

const wrappedQuestion: Episode = {
	name: "wrapped-question",
	summary: "resolve_question checks off an open question whose text wraps",
	fixture: { body: QUESTION_BODY },
	scripts: {
		"refine-1": {
			kind: "refine",
			steps: [
				{
					t: "call",
					tool: "resolve_question",
					payload: { question: WRAPPED_QUESTION, answer: WRAPPED_ANSWER },
				},
			],
		},
	},
	spawns: [{ kind: "refine", ordinal: 1, exit: 0 }],
	rounds: 0,
	run: async (ctx) => {
		await ctx.rpc("session/spawn", {
			kind: "refine",
			storyId: ctx.storyId,
			prompt: "Resolve the open question.",
		});
		await acceptProposal(
			ctx,
			"the resolve_question proposal",
			(proposal) => proposal.tool === "resolve_question",
		);
		const question = await ctx.obs.waitFor(
			"the wrapped open question to read back checked",
			() => {
				const first = findStory(ctx).brief.openQuestions[0];
				return first?.checked === true ? first : undefined;
			},
		);
		assert(
			question.text === WRAPPED_QUESTION,
			`the open question parsed as "${question.text}"`,
		);
		assert(
			ctx.body().includes(`- ${WRAPPED_QUESTION}: ${WRAPPED_ANSWER}`),
			"the answer was never folded under Approach",
		);
	},
};

// A markdown reply carrying every construct the transcript renders: a list,
// emphasis, a safe link, an unsafe one, raw markup, and a fenced block.
const MARKDOWN_REPLY = [
	"Here is what the run found:",
	"",
	"- a **bold** claim",
	"- a [link](https://example.com) and a [bad one](javascript:alert(1))",
	"- raw markup: <b>not bold</b>",
	"",
	"```ts",
	"const folded = scanChecklist(lines);",
	"```",
	"",
	"That is the whole reply.",
].join("\n");

// Split so the pane sees the reply as growing prefixes, one of which cuts a
// fence open.
const REPLY_CHUNKS = [
	MARKDOWN_REPLY.slice(0, 40),
	MARKDOWN_REPLY.slice(40, 150),
	MARKDOWN_REPLY.slice(150),
];

const CONVERSATION_HOLD = "conversation-live-hold";
const CONVERSATION_HOLD_TWO = "conversation-live-hold-2";

// A paragraph appended after each hold, so an operator can park the pane and
// watch what the next append does to it.
function appended(text: string): StubStep {
	return {
		t: "emit",
		event: {
			type: "stream_event",
			event: {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: `\n\n${text}` },
			},
		},
	};
}

const conversationLive: Episode = {
	name: "conversation-live",
	summary: "a transcript carrying markdown, a tool call and a compaction",
	halts: true,
	scripts: {
		"refine-1": SILENT_REFINE,
		"refine-2": {
			kind: "refine",
			steps: [
				{
					t: "emit",
					event: {
						type: "stream_event",
						event: {
							type: "content_block_start",
							index: 0,
							content_block: { type: "text", text: "" },
						},
					},
				},
				...REPLY_CHUNKS.map((text) => ({
					t: "emit" as const,
					event: {
						type: "stream_event",
						event: {
							type: "content_block_delta",
							index: 0,
							delta: { type: "text_delta", text },
						},
					},
				})),
				{
					t: "emit",
					event: {
						type: "system",
						subtype: "compact_boundary",
						compact_metadata: {
							trigger: "auto",
							pre_tokens: 148000,
							post_tokens: 32000,
						},
					},
				},
				{
					t: "emit",
					event: {
						type: "assistant",
						message: {
							content: [
								{
									type: "tool_use",
									id: "toolu_live_1",
									name: "Read",
									input: { file_path: "src/board/markdown.ts" },
								},
							],
						},
					},
				},
				{
					t: "emit",
					event: {
						type: "user",
						message: {
							content: [
								{
									type: "tool_result",
									tool_use_id: "toolu_live_1",
									content: "export function parseChecklist(...)",
								},
							],
						},
					},
				},
				{ t: "wait", sentinel: CONVERSATION_HOLD, timeoutMs: OPERATOR_WAIT_MS },
				appended("A paragraph appended while the reader sat scrolled up."),
				{
					t: "wait",
					sentinel: CONVERSATION_HOLD_TWO,
					timeoutMs: OPERATOR_WAIT_MS,
				},
				appended("A paragraph appended while the reader sat at the bottom."),
			],
		},
	},
	spawns: [
		{ kind: "refine", ordinal: 1, exit: 0 },
		{ kind: "refine", ordinal: 2, exit: 0 },
	],
	rounds: 0,
	run: async (ctx) => {
		const live = await spawnRefineChat(ctx);
		ctx.say(`refine chat ${live} is open and idle`);
		await ctx.halt(
			"open the drawer's chat for this story and send a message: the reply streams in as markdown with a compaction boundary and a tool call, the sent message anchors to the top of the pane, and the scroll-to-bottom control appears once you scroll away from the end. Then scroll up into the history and press Enter",
		);
		releaseSentinel(ctx.scratch, CONVERSATION_HOLD);
		await ctx.halt(
			"a paragraph was appended while you sat scrolled up: the pane stayed where it was. Now scroll to the bottom and press Enter",
		);
		releaseSentinel(ctx.scratch, CONVERSATION_HOLD_TWO);
		await ctx.halt(
			"a second paragraph was appended while you sat at the bottom: the pane followed it",
		);
		await ctx.obs.waitFor("the held turn to close", () =>
			ctx.obs.closed().find((each) => each.sessionId === live),
		);
	},
};

const DEFINE_DRAFTS = [
	{
		slug: "first-slice",
		title: "First slice",
		goal: "Land the thinnest path through every layer.",
		depends: [],
	},
	{
		slug: "second-slice",
		title: "Second slice",
		goal: "Build the surface the first slice proved out.",
		depends: ["first-slice"],
	},
	{
		slug: "third-slice",
		title: "Third slice",
		goal: "Close the loop the first two opened.",
		depends: [],
	},
];

const defineCards: Episode = {
	name: "define-cards",
	summary:
		"a define session proposes three stories and accepting them writes three cards",
	scripts: {
		"define-1": {
			kind: "define",
			steps: [
				{
					t: "call",
					tool: "propose_stories",
					payload: {
						goal: "Break the harness epic into slices.",
						rationale: "Three slices, each demoable on its own.",
						stories: DEFINE_DRAFTS,
					},
				},
			],
		},
	},
	spawns: [{ kind: "define", ordinal: 1, exit: 0 }],
	rounds: 0,
	async run(ctx) {
		await spawnDefineChat(ctx, "001");
		const proposal = await acceptEveryItem(
			ctx,
			"the propose_stories proposal",
			(each) => each.tool === "propose_stories",
		);
		assert(
			proposal.items.length === DEFINE_DRAFTS.length,
			`the proposal carried ${proposal.items.length} items, not ${DEFINE_DRAFTS.length}`,
		);
		const created = await ctx.obs.waitFor(
			"the three accepted drafts to land as story files",
			() => {
				const stories = ctx.obs
					.board()
					?.stories.filter((story) => story.epicId === "001");
				return stories !== undefined && stories.length === 4
					? stories
					: undefined;
			},
		);
		const titles = created.map((story) => story.brief.title);
		for (const draft of DEFINE_DRAFTS) {
			assert(
				titles.includes(draft.title),
				`no card titled "${draft.title}" on the board: ${titles.join(", ")}`,
			);
		}
		const second = created.find(
			(story) => story.brief.title === "Second slice",
		);
		assert(
			second?.frontmatter.status === "backlog",
			`the created card is ${String(second?.frontmatter.status)}, not backlog`,
		);
		assert(
			second.frontmatter.depends.length === 1,
			`"second-slice" depends on ${JSON.stringify(second.frontmatter.depends)}, not on its sibling`,
		);
		ctx.say(
			`three cards created: ${titles.filter((title) => title !== FIXTURE_TITLE).join(", ")}`,
		);
	},
};

const SHAPE_DECISION = "Does the harness thread settle its own scope?";

const shapeDecision: Episode = {
	name: "shape-decision",
	summary:
		"a shape session raises a decision and the answer resumes the same session",
	scripts: {
		"shape-1": {
			kind: "shape",
			steps: [
				{
					t: "call",
					tool: "raise_decision",
					payload: {
						decision: SHAPE_DECISION,
						settledBy: "human",
						recommendation: "Yes, the thread owns its scope.",
						options: ["Yes", "No"],
					},
				},
			],
		},
		"shape-2": { kind: "shape", steps: [] },
	},
	spawns: [
		{ kind: "shape", ordinal: 1, exit: 0 },
		{ kind: "shape", ordinal: 2, exit: 0 },
	],
	rounds: 0,
	async run(ctx) {
		const first = await spawnShapeChat(
			ctx,
			"Shape the harness thread into epics.",
		);
		const thread = await ctx.obs.waitFor(
			"the shaping thread to carry the raised decision",
			() =>
				ctx.obs
					.board()
					?.shaping.find((each) =>
						each.decisions.some((item) => item.text.includes(SHAPE_DECISION)),
					),
		);
		const raised = thread.decisions.find((item) =>
			item.text.includes(SHAPE_DECISION),
		);
		assert(
			raised?.checked === false,
			"the raised decision landed already checked off",
		);
		ctx.say(`decision raised into ${thread.slug}: ${raised.text}`);
		await ctx.rpc("shaping/resolveDecision", {
			slug: thread.slug,
			decision: SHAPE_DECISION,
			answer: "Yes, the thread owns its scope.",
		});
		const settled = await ctx.obs.waitFor(
			"the decision to check off in the thread file",
			() => {
				const item = ctx.obs
					.board()
					?.shaping.find((each) => each.slug === thread.slug)
					?.decisions.find((each) => each.text.includes(SHAPE_DECISION));
				return item?.checked === true ? item : undefined;
			},
		);
		ctx.say(`decision settled: ${settled.text}`);
		const resumed = await ctx.obs.waitFor(
			"the answer to resume the shape session",
			() => ctx.obs.closed().filter((each) => each.sessionId === first)[1],
		);
		assert(
			resumed.sessionId === first,
			`the answer resumed ${String(resumed.sessionId)}, not the session that raised it`,
		);
		ctx.say(`shape session ${first} resumed with the answer`);
	},
};

// A run closes to review on its result frame alone: `evidenceClose` reads
// `cleanResult` before the Stop hook's POST (`runs.ts:754-783`), and the stub
// runs no hook commands.
const RUN_NOTE = {
	t: "call" as const,
	tool: "update_card",
	payload: {
		note: "verify: the harness drove this run without spending pool tokens",
	},
};

const GRADING: StubScript = {
	kind: "review",
	steps: [
		{
			t: "call",
			tool: "grade_criteria",
			payload: {
				grades: [
					{
						criterion:
							"The story reaches Ready with a recorded gate verdict (file)",
						verdict: "pass",
						evidence:
							"the fixture story carries the verdict this episode wrote",
					},
				],
			},
		},
	],
};

const runClose: Episode = {
	name: "run-close",
	summary: "a run spawn claims its script and closes the story to review",
	fixture: { status: "ready", gate: READY_GATE },
	scripts: {
		"run-1": { kind: "run", steps: [RUN_NOTE] },
		// The review close dispatches the grader, so a run episode drives two
		// kinds whether it means to or not.
		"review-1": GRADING,
	},
	spawns: [
		{ kind: "run", ordinal: 1, exit: 0 },
		{ kind: "review", ordinal: 1, exit: 0 },
	],
	rounds: 0,
	async run(ctx) {
		await ctx.rpc("run/start", { id: ctx.storyId });
		const reviewed = await ctx.obs.waitFor(
			`story ${ctx.storyId} to close into review`,
			() => {
				const story = ctx.obs
					.board()
					?.stories.find((each) => each.id === ctx.storyId);
				return story?.frontmatter.status === "review" ? story : undefined;
			},
		);
		const entry = reviewed.frontmatter.runs.at(-1);
		assert(
			entry?.outcome === "review",
			`the run entry closed ${String(entry?.outcome)}, not review`,
		);
		assert(
			entry.error === undefined,
			`the run closed to review carrying an error: ${String(entry.error)}`,
		);
		ctx.say(`run ${entry.session} closed to review with no Stop-hook POST`);
	},
};

const RUN_OPEN = "run-live-open";
const RUN_STEERED = "run-live-steered";
const RUN_HOLD = "run-live-hold";

const runLive: Episode = {
	name: "run-live",
	summary:
		"a live run timeline carrying markdown, a compaction and an Edit, held for a steer",
	halts: true,
	fixture: { status: "ready", gate: READY_GATE },
	scripts: {
		"run-1": {
			kind: "run",
			steps: [
				// A stub run writes no CLI transcript, so nothing rehydrates: the
				// frames have to arrive while the operator is already watching.
				{ t: "wait", sentinel: RUN_OPEN, timeoutMs: OPERATOR_WAIT_MS },
				{
					t: "emit",
					event: {
						type: "stream_event",
						event: {
							type: "content_block_start",
							index: 0,
							content_block: { type: "text", text: "" },
						},
					},
				},
				...REPLY_CHUNKS.map((text) => ({
					t: "emit" as const,
					event: {
						type: "stream_event",
						event: {
							type: "content_block_delta",
							index: 0,
							delta: { type: "text_delta", text },
						},
					},
				})),
				{
					t: "emit",
					event: {
						type: "system",
						subtype: "compact_boundary",
						compact_metadata: {
							trigger: "auto",
							pre_tokens: 148000,
							post_tokens: 32000,
						},
					},
				},
				{
					t: "emit",
					event: {
						type: "assistant",
						message: {
							content: [
								{
									type: "tool_use",
									id: "toolu_run_1",
									name: "Edit",
									input: {
										file_path: "README.md",
										old_string: "# Harness scratch",
										new_string: "# Harness scratch\n\nEdited by the run.",
									},
								},
							],
						},
					},
				},
				// Held so an operator can steer the run. The steer kills this
				// segment (`runs.ts:1147-1161`), so the sentinel never arrives and
				// the wait dies with the process group rather than timing out.
				{ t: "wait", sentinel: RUN_HOLD, timeoutMs: OPERATOR_WAIT_MS },
			],
		},
		// The resumed segment holds too: a segment that ends at once closes the
		// run to review before the steer message has been seen in a live pane.
		"run-2": {
			kind: "run",
			steps: [
				{ t: "wait", sentinel: RUN_STEERED, timeoutMs: OPERATOR_WAIT_MS },
				RUN_NOTE,
			],
		},
		"review-1": GRADING,
	},
	spawns: [
		{ kind: "run", ordinal: 1, exit: null },
		{ kind: "run", ordinal: 2, exit: 0 },
		{ kind: "review", ordinal: 1, exit: 0 },
	],
	rounds: 0,
	async run(ctx) {
		await ctx.rpc("run/start", { id: ctx.storyId });
		await ctx.obs.waitFor(`story ${ctx.storyId} to read running`, () =>
			ctx.obs.board()?.stories.find((each) => each.id === ctx.storyId)
				?.frontmatter.status === "running"
				? "running"
				: undefined,
		);
		await ctx.halt(
			`open ${ctx.storyId} and its Activity tab, then press Enter to stream the turn into it`,
		);
		releaseSentinel(ctx.scratch, RUN_OPEN);
		await ctx.halt(
			"the reply renders as markdown, the compaction boundary shows its line, and the Edit renders its diff. Now steer the run from the box below the timeline and press Enter",
		);
		await ctx.halt(
			"the steer message anchored at the top of the timeline with the resumed segment streaming below it. Press Enter to close the run",
		);
		releaseSentinel(ctx.scratch, RUN_STEERED);
		await ctx.obs.waitFor(`story ${ctx.storyId} to close into review`, () =>
			ctx.obs.board()?.stories.find((each) => each.id === ctx.storyId)
				?.frontmatter.status === "review"
				? "review"
				: undefined,
		);
		ctx.say(
			"the steer killed the held segment and resumed the run to its close",
		);
	},
};

export const EPISODES: readonly Episode[] = [
	flagless,
	oneFlag,
	contested,
	exhausted,
	exitAfterInit,
	missingScript,
	invalidPayload,
	concession,
	historyRestart,
	historyCleared,
	historyBlockStyle,
	historyCold,
	refineTurnGuard,
	refineTurnPark,
	refineTurnFailureRelease,
	refineTurnLive,
	reseedRetry,
	reseedNotOnRecord,
	reseedPark,
	wrappedBrief,
	wrappedQuestion,
	conversationLive,
	defineCards,
	shapeDecision,
	runClose,
	runLive,
];
