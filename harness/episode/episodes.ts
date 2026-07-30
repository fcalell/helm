import { readFileSync } from "node:fs";
import { splitFrontmatter } from "../../src/board/markdown.ts";
import { readStubLog } from "../stub-claude/log.ts";
import type { StubScript } from "../stub-claude/script.ts";
import {
	NO_SCRIPT_EXIT,
	TOOL_FAILURE_EXIT,
	WAIT_TIMEOUT_EXIT,
} from "../stub-claude/stub.ts";
import {
	acceptFix,
	assert,
	type Episode,
	type EpisodeContext,
	findStory,
	flagStatus,
	moveStory,
	moveToReady,
	recordedRounds,
	releaseSentinel,
	spawnRefineChat,
	waitForFlag,
	waitForReady,
	waitForRecord,
	writeScript,
} from "./driver.ts";
import { RpcError } from "./rpc.ts";

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

const SILENT_REFINE: StubScript = { role: "refine", steps: [] };
const SILENT_ADVERSARY: StubScript = { role: "adversary", steps: [] };

function flagging(
	...flags: Array<{ title: string; detail: string }>
): StubScript {
	return {
		role: "adversary",
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
		role: "refine",
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
		role: "refine",
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
		{ role: "adversary", ordinal: 2, exit: 0 },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
		{ role: "adversary", ordinal: 2, exit: 0 },
		{ role: "refine", ordinal: 3, exit: 0 },
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
		"adversary-1": { role: "adversary", steps: [{ t: "exit", code: 3 }] },
	},
	spawns: [
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 3 },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: NO_SCRIPT_EXIT, claims: false },
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
			role: "adversary",
			steps: [
				{ t: "call", tool: "flag_risk", payload: { title: "", detail: "" } },
			],
		},
	},
	spawns: [
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: TOOL_FAILURE_EXIT },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
		{ role: "adversary", ordinal: 2, exit: 0 },
		{ role: "refine", ordinal: 3, exit: 0 },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
		{ role: "adversary", ordinal: 2, exit: 0 },
		{ role: "refine", ordinal: 3, exit: 0 },
		{ role: "adversary", ordinal: 3, exit: 0 },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
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
		role: "refine",
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
	role: "refine",
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
		{ role: "refine", ordinal: 3, exit: 0 },
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
			role: "adversary",
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
		{ role: "refine", ordinal: 3, exit: 0 },
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
		{ role: "refine", ordinal: 1, exit: NO_SCRIPT_EXIT, claims: false },
		{ role: "refine", ordinal: 1, exit: WAIT_TIMEOUT_EXIT },
		{ role: "refine", ordinal: 2, exit: 0 },
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
			role: "refine",
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
	spawns: [{ role: "refine", ordinal: 1, exit: 0 }],
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
		{ role: "adversary", ordinal: 2, exit: 0 },
		{ role: "refine", ordinal: 3, exit: 0 },
		{ role: "adversary", ordinal: 3, exit: 0 },
		{ role: "refine", ordinal: 4, exit: 0 },
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
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
			role: "adversary",
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
		{ role: "refine", ordinal: 1, exit: 0 },
		{ role: "adversary", ordinal: 1, exit: 0 },
		{ role: "refine", ordinal: 2, exit: 0 },
		{ role: "adversary", ordinal: 2, exit: 0 },
		{ role: "refine", ordinal: 3, exit: 0 },
		{ role: "adversary", ordinal: 3, exit: 0 },
		{ role: "refine", ordinal: 4, exit: 0 },
		{ role: "refine", ordinal: 5, exit: NO_SCRIPT_EXIT, claims: false },
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
					.find((entry) => entry.role === "refine"),
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
];
