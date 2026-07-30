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
	moveToReady,
	spawnRefineChat,
	waitForFlag,
	waitForReady,
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
		const answered = await ctx.halt(
			"the drawer shows the contested flag with its counter-argument and the card is still in Refining",
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
		await ctx.halt(
			"the gate panel shows both rounds in its history and the card carries the gate badge",
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

export const EPISODES: readonly Episode[] = [
	flagless,
	oneFlag,
	contested,
	exhausted,
	exitAfterInit,
	missingScript,
	invalidPayload,
	concession,
];
