import { readFileSync } from "node:fs";
import { splitFrontmatter } from "../../src/board/markdown.ts";
import { readStubLog } from "../stub-claude/log.ts";
import type { StubScript } from "../stub-claude/script.ts";
import { NO_SCRIPT_EXIT, TOOL_FAILURE_EXIT } from "../stub-claude/stub.ts";
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
	spawnRefineChat,
	waitForFlag,
	waitForReady,
	waitForRecord,
} from "./driver.ts";

const FLAG_ONE = {
	title: "No failure-path criterion",
	detail:
		"Every criterion is happy path; nothing checks what the round does when a spawn dies.",
};
const FLAG_TWO = {
	title: "Blast radius omits the scratch config",
	detail: "The brief never says which files outside the board the work writes.",
};

const DISMISS_REASON = "the failure path rides its own probe";

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

const FIX_ONE = fixing(
	"Out of scope",
	"Everything the episode does not drive, and the spawn-failure path the probes own.",
	FLAG_ONE.title,
);
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
];
