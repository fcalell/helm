import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ApiError } from "@fcalell/plugin-api/error";
import { defineService } from "@fcalell/plugin-node/server";
import { briefHash } from "../../board/hash.ts";
import type {
	Preset,
	Run,
	Status,
	StoryFrontmatter,
} from "../../board/schema.ts";
import {
	InvalidBoardFileError,
	isENOENT,
	readStoryFile,
	STORY_FILE_RE,
	type Story,
	writeStory,
} from "../../board/store.ts";
import { canTransition, verdictValid } from "../../board/transitions.ts";
import type { SessionResult } from "../../sessions/events.ts";
import {
	GUARDED_ALLOWLIST,
	MANUAL_ALLOWLIST,
	MCP_SERVER_NAME,
} from "../../sessions/kinds.ts";
import {
	questionAnswerPrompt,
	runPrompt,
	steeringPrompt,
} from "../../sessions/prompts.ts";
import type { ManagedRepo } from "../config.ts";
import { runHookUrl } from "../mcp/registry.ts";
import type { AskUserPayload } from "../mcp/schemas.ts";
import { autoAllowlist } from "../permissions.ts";
import { groupAlive, killProcessGroup } from "../process-group.ts";
import {
	ensureWorktree,
	helmDiffPaths,
	safetyCommit,
	worktreeExists,
	worktreePath,
	worktreesDir,
} from "../worktrees.ts";
import { enqueueWrite } from "../write-queue.ts";
import { boardSnapshot, managedRepo } from "./board.ts";
import { type RunTurnHandle, spawnRunSession } from "./sessions.ts";

// A wedged CLI (auth stall, network hang) costs one failed run.start, never
// the story's run path: a pre-init process has no session id and is
// unreachable through session.kill.
const INIT_TIMEOUT_MS = 60_000;

// How long run.answer waits out the asking process's teardown before
// treating the run as genuinely live (the spawn-to-init standard: one
// bounded wait, never a wedge).
const CLOSE_WAIT_MS = 60_000;

const RESTART_ERROR = "orchestrator restarted mid-run";
const STOPPED_ERROR = "stopped by the user";

// The Resume button's bare steer still carries the interruption notice.
const RESUME_MESSAGE = "Continue the run.";

const PERMISSION_TOOL = `mcp__${MCP_SERVER_NAME}__approve`;

// CLI-side ceiling for a held permission approval (default 5 minutes, raised
// to four hours); the server side showed no ceiling on the orchestrator's
// HTTP adapter (claude-integration.md §Permission prompts).
const MCP_TOOL_TIMEOUT_MS = 4 * 60 * 60 * 1000;

// Held for the run's whole lifetime, not just start-to-init.
interface RunState {
	storyId: string;
	hookToken: string;
	hookPosted: boolean;
	exited: boolean;
	pid?: number;
	sessionId?: string;
	branch?: string;
	worktree?: string;
	// Set synchronously before a deliberate kill, so finishRun can tell a
	// steer/pause/stop from a crash.
	intent?: "steer" | "pause" | "stop";
	// Resolves `armed` once the `running` write lands; the close handler
	// awaits it to decide armed vs bypass instead of assuming order.
	initWrite?: Promise<"armed" | "aborted">;
	// Resolves after close handling and cleanup; run.answer awaits it so an
	// asking process's teardown never races the resume.
	closed?: Promise<void>;
}

const states = new Map<string, RunState>();
const hookTokens = new Map<string, RunState>();
let log: { info(m: string): void; error(m: string): void } | undefined;

function pidFilePath(storyId: string): string {
	return join(worktreesDir(managedRepo()), `${storyId}.pid`);
}

function settingsFilePath(storyId: string): string {
	return join(worktreesDir(managedRepo()), `${storyId}.settings.json`);
}

// The per-spawn settings: the `.helm/` deny rules (spike-verified `//`
// absolute anchoring; the file itself lives outside the worktree) and the
// Stop-hook POST backstop.
function runSettings(worktree: string, hookToken: string) {
	const helmGlob = `//${worktree.replace(/^\/+/, "")}/.helm/**`;
	return {
		permissions: { deny: [`Edit(${helmGlob})`, `Write(${helmGlob})`] },
		hooks: {
			Stop: [
				{
					hooks: [
						{
							type: "command",
							command: `curl -s -m 5 -X POST ${runHookUrl(hookToken)}`,
						},
					],
				},
			],
		},
	};
}

function errorText(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function findStory(storyId: string): Story {
	const story = boardSnapshot().stories.find((each) => each.id === storyId);
	if (story === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: `no story with id ${storyId}`,
		});
	}
	return story;
}

async function readStoryOrApiError(
	path: string,
	epicId: string,
	storyId: string,
): Promise<Story> {
	try {
		return await readStoryFile(path, epicId);
	} catch (error) {
		if (isENOENT(error)) {
			throw new ApiError("NOT_FOUND", {
				message: `no story with id ${storyId}`,
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

// `ready → running` plus gate freshness: the transitions table only checks
// the verdict on `to: ready`, but a hand edit to a Ready card's body stales
// it while the status stays `ready`, and an uncertified brief must not run.
function validateStart(story: Story): void {
	const from = story.frontmatter.status;
	const check = canTransition(from, "running", {
		brief: story.brief,
		body: story.body,
		gate: story.frontmatter.gate,
	});
	if (!check.ok) {
		throw new ApiError("ILLEGAL_TRANSITION", {
			status: 409,
			message: check.reason,
			data: { from, to: "running", reason: check.reason },
		});
	}
	if (!verdictValid(story.frontmatter.gate, story.body)) {
		const reason = "brief edited since the gate; re-run the ready gate";
		throw new ApiError("ILLEGAL_TRANSITION", {
			status: 409,
			message: reason,
			data: { from, to: "running", reason },
		});
	}
}

// What a preset contributes to the spawn: the effective allowlist (replacing
// the registry row's), the check command's extra patterns (Auto only: under
// Guarded and Manual the check command prompting is the supervision), and
// the permission tool with its raised CLI-side timeout.
interface PresetSpawn {
	tools: readonly string[];
	extraTools: readonly string[];
	permissionPromptTool?: string;
	env?: Record<string, string>;
}

async function presetSpawn(
	preset: Preset,
	repo: ManagedRepo,
): Promise<PresetSpawn> {
	if (preset === "auto") {
		return {
			tools: await autoAllowlist(repo),
			extraTools:
				repo.checkCommand === undefined
					? []
					: [`Bash(${repo.checkCommand})`, `Bash(${repo.checkCommand}:*)`],
		};
	}
	return {
		tools: preset === "guarded" ? GUARDED_ALLOWLIST : MANUAL_ALLOWLIST,
		extraTools: [],
		permissionPromptTool: PERMISSION_TOOL,
		env: { MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) },
	};
}

function mintBranch(story: Story): string {
	const slug = STORY_FILE_RE.exec(basename(story.path))?.[2] ?? "story";
	return `helm/${story.id}-${slug}`;
}

async function cleanup(state: RunState): Promise<void> {
	if (states.get(state.storyId) === state) states.delete(state.storyId);
	hookTokens.delete(state.hookToken);
	try {
		await rm(pidFilePath(state.storyId), { force: true });
	} catch {
		// Best-effort: reconciliation tolerates a stale pid file.
	}
}

export async function startRun(
	storyId: string,
): Promise<{ sessionId: string }> {
	if (states.has(storyId)) throw runActive();
	const known = findStory(storyId);
	const state: RunState = {
		storyId,
		hookToken: randomUUID(),
		hookPosted: false,
		exited: false,
	};
	states.set(storyId, state);
	hookTokens.set(state.hookToken, state);
	try {
		return await start(state, known.path, known.epicId);
	} catch (error) {
		await cleanup(state);
		throw error;
	}
}

async function start(
	state: RunState,
	path: string,
	epicId: string,
): Promise<{ sessionId: string }> {
	const repo = managedRepo();
	const { storyId } = state;

	// Fresh read inside the write queue: validate, and mint + persist the
	// branch only when the field is absent. The queue is never held across
	// checkout or spawn; the lifetime guard covers that window.
	const prepared = await enqueueWrite(async () => {
		const current = await readStoryOrApiError(path, epicId, storyId);
		validateStart(current);
		let branch = current.frontmatter.branch;
		if (branch === undefined) {
			branch = mintBranch(current);
			await writeStory({
				path,
				frontmatter: { ...current.frontmatter, branch },
				body: current.body,
			});
		}
		return {
			branch,
			body: current.body,
			preset: current.frontmatter.preset ?? ("guarded" as const),
		};
	});
	state.branch = prepared.branch;

	// Before any spawn work: an invalid permissions override must fail the
	// start loudly, never spawn on a guessed allowlist.
	const spawn = await presetSpawn(prepared.preset, repo);

	let worktree: string;
	try {
		worktree = (
			await ensureWorktree({ repo, storyId, branch: prepared.branch })
		).path;
		// The reuse check's never-proceed-as-clean rule: committed `.helm/`
		// changes on the branch abort the start.
		const violations = await helmDiffPaths(
			worktree,
			repo.mainBranch,
			prepared.branch,
		);
		if (violations.length > 0) {
			throw new Error(
				`story branch carries .helm/ changes: ${violations.join(", ")}`,
			);
		}
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw new ApiError("RUN_FAILED", { message: errorText(error) });
	}
	state.worktree = worktree;

	const settingsPath = settingsFilePath(storyId);
	await writeFile(
		settingsPath,
		`${JSON.stringify(runSettings(worktree, state.hookToken), null, "\t")}\n`,
	);

	const handle = spawnRunSession({
		storyId,
		prompt: runPrompt(prepared.body, repo.checkCommand, prepared.preset),
		cwd: worktree,
		settingsPath,
		...spawn,
	});
	state.pid = handle.pid;
	trackClose(state, path, epicId, handle);
	if (handle.pid !== undefined) {
		await writeFile(pidFilePath(storyId), `${handle.pid}\n`);
	}

	const init = await raceInit(handle, state);
	state.sessionId = init.sessionId;

	// Re-validates inside the write queue: `state.exited` short-circuits a dead
	// process, and a non-ready or stale story aborts without writing.
	state.initWrite = enqueueWrite(async (): Promise<"armed" | "aborted"> => {
		if (state.exited) return "aborted";
		let current: Story;
		try {
			current = await readStoryFile(path, epicId);
		} catch {
			return "aborted";
		}
		if (
			current.frontmatter.status !== "ready" ||
			!verdictValid(current.frontmatter.gate, current.body)
		) {
			return "aborted";
		}
		const runs = current.frontmatter.runs;
		const entry: Run = {
			n: runs.reduce((max, run) => Math.max(max, run.n), 0) + 1,
			session: init.sessionId,
			brief: briefHash(current.body),
			started: new Date().toISOString(),
		};
		await writeStory({
			path,
			frontmatter: {
				...current.frontmatter,
				status: "running",
				runs: [...runs, entry],
			},
			body: current.body,
		});
		return "armed";
	});
	if ((await state.initWrite) !== "armed") {
		if (state.pid !== undefined) await killProcessGroup(state.pid);
		const reason = "story left ready during run start; the move wins";
		throw new ApiError("ILLEGAL_TRANSITION", {
			status: 409,
			message: reason,
			data: { from: "ready", to: "running", reason },
		});
	}
	return { sessionId: init.sessionId };
}

// Wires exit bookkeeping and close handling; `state.closed` resolves only
// after finishRun's cleanup, which is what run.answer waits out.
function trackClose(
	state: RunState,
	path: string,
	epicId: string,
	handle: RunTurnHandle,
): void {
	const closed = handle.done.then((turn) => {
		state.exited = true;
		return turn;
	});
	state.closed = closed
		.then((turn) => finishRun(state, path, epicId, turn))
		.catch((error) => {
			log?.error(
				`run ${state.storyId}: close handling failed: ${errorText(error)}`,
			);
		});
}

async function raceInit(handle: RunTurnHandle, state: RunState) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`no system/init within ${INIT_TIMEOUT_MS / 1000}s`));
		}, INIT_TIMEOUT_MS);
	});
	try {
		return await Promise.race([handle.started, timeout]);
	} catch (error) {
		if (state.pid !== undefined) await killProcessGroup(state.pid);
		throw new ApiError("SPAWN_FAILED", { message: errorText(error) });
	} finally {
		clearTimeout(timer);
	}
}

async function finishRun(
	state: RunState,
	path: string,
	epicId: string,
	turn: Awaited<RunTurnHandle["done"]>,
): Promise<void> {
	const armed = await (state.initWrite ?? Promise.resolve("aborted")).catch(
		() => "aborted" as const,
	);
	// An exit before the `running` write landed bypasses close handling: the
	// failure surfaced as run.start's error (guard cleared, nothing written).
	if (armed !== "armed") {
		await cleanup(state);
		return;
	}
	const repo = managedRepo();
	const worktree = state.worktree ?? worktreePath(repo, state.storyId);
	const branch = state.branch;

	// Confirm the group is dead before touching the tree: the safety commit
	// must never race a still-writing build subprocess.
	let teardownError: string | undefined;
	let groupDead = true;
	if (state.pid !== undefined && groupAlive(state.pid)) {
		groupDead = await killProcessGroup(state.pid);
	}
	if (!groupDead) {
		teardownError =
			"run process group survived SIGKILL; leftovers not committed";
		log?.error(`run ${state.storyId}: ${teardownError}`);
	} else {
		try {
			await safetyCommit(worktree);
		} catch (commitError) {
			teardownError = `safety commit failed: ${errorText(commitError)}`;
		}
		if (teardownError === undefined && branch !== undefined) {
			try {
				const violations = await helmDiffPaths(
					worktree,
					repo.mainBranch,
					branch,
				);
				if (violations.length > 0) {
					teardownError = `run committed .helm/ changes: ${violations.join(", ")}`;
				}
			} catch (diffError) {
				teardownError = errorText(diffError);
			}
		}
	}

	const result = turn.result;
	const cleanResult =
		turn.resultSeen && result !== undefined && !result.isError;
	// Only a clean completion proves the run ended on its own: the CLI flushes
	// an error result on SIGTERM (measured live, claude-integration.md §Hooks),
	// so an error frame under a deliberate kill is the kill's echo, not
	// evidence. The Stop hook fires only on clean completions, so a POST with
	// no observed result still counts as one (without tokens/minutes).
	const cleanCompletion = cleanResult || state.hookPosted;

	// The exit-evidence mapping, ignoring intents: teardown failures first,
	// then the result frame, then the hook POST, then the crash shape.
	function evidenceClose(): { outcome: "review" | "blocked"; error?: string } {
		if (teardownError !== undefined) {
			return { outcome: "blocked", error: teardownError };
		}
		if (cleanResult) return { outcome: "review" };
		if (turn.resultSeen) {
			return {
				outcome: "blocked",
				error: errorText(result?.text ?? "run errored"),
			};
		}
		if (state.hookPosted) return { outcome: "review" };
		return {
			outcome: "blocked",
			error:
				turn.outcome.signal !== null
					? `run killed (${turn.outcome.signal})`
					: `run exited (code ${turn.outcome.exitCode}) without a result`,
		};
	}

	try {
		await enqueueWrite(async () => {
			const current = await readStoryFile(path, epicId);
			const runs = [...current.frontmatter.runs];
			// The open entry is the one the init write armed (the same key the
			// resume and reconciliation use); a hand edit that closed it leaves
			// nothing to update.
			const open = runs.findLastIndex((run) => run.outcome === undefined);
			const openRun = runs[open];
			const question = openRun?.question;
			// Priority order below: cleanCompletion, then teardownError, then
			// state.intent === "stop", then `question`, then steer/pause
			// (api.md §Procedures, run.pause and run.stop rows).
			let close: { outcome: "review" | "blocked"; error?: string } | undefined;
			let paused = false;
			if (cleanCompletion && question === undefined) {
				close = evidenceClose();
			} else if (teardownError !== undefined) {
				close = { outcome: "blocked", error: teardownError };
			} else if (state.intent === "stop") {
				close = { outcome: "blocked", error: STOPPED_ERROR };
			} else if (
				question !== undefined &&
				(cleanResult ||
					state.hookPosted ||
					state.intent === "steer" ||
					state.intent === "pause")
			) {
				close = undefined;
			} else if (state.intent === "steer" || state.intent === "pause") {
				close = undefined;
				paused = state.intent === "pause";
			} else {
				close = evidenceClose();
			}
			if (openRun !== undefined) {
				// A closing write drops `paused`; a segment end keeps the entry open
				// with usage accumulated across segments.
				const { paused: _dropped, ...closable } = openRun;
				runs[open] = {
					...(close === undefined ? openRun : closable),
					...addUsage(openRun, result),
					...(close !== undefined && {
						outcome: close.outcome,
						...(close.error !== undefined && { error: close.error }),
					}),
					...(paused && { paused: true }),
				};
			}
			// A mid-run move or hand edit already parked the card elsewhere: the
			// user's move wins, and the entry update is bookkeeping. A blocked
			// close under needs-input (a crash inside the ask_user turn, or a
			// stop) parks the card in Blocked while the question stays on the
			// entry as record.
			let status = current.frontmatter.status;
			if (close !== undefined) {
				if (status === "running") status = close.outcome;
				else if (status === "needs-input" && close.outcome === "blocked") {
					status = "blocked";
				}
			}
			await writeStory({
				path: current.path,
				frontmatter: { ...current.frontmatter, status, runs },
				body: current.body,
			});
		});
	} catch (writeError) {
		log?.error(
			`run ${state.storyId}: close write failed: ${errorText(writeError)}`,
		);
	}
	await cleanup(state);
}

// A run's ask_user: one queued write lands the question on the open run
// entry (frontmatter survives a restart, which the in-memory chat path
// cannot give a run) and flips `running → needs-input` when that transition
// applies; a card the user already moved keeps its status, the question
// still lands as bookkeeping. False when no open entry exists to carry it.
export async function runNeedsInput(
	storyId: string,
	payload: AskUserPayload,
): Promise<boolean> {
	const story = boardSnapshot().stories.find((each) => each.id === storyId);
	if (story === undefined) return false;
	return enqueueWrite(async () => {
		let current: Story;
		try {
			current = await readStoryFile(story.path, story.epicId);
		} catch {
			return false;
		}
		const runs = [...current.frontmatter.runs];
		const open = runs.findLastIndex((run) => run.outcome === undefined);
		const openRun = runs[open];
		if (openRun === undefined) return false;
		runs[open] = {
			...openRun,
			question: {
				text: payload.question,
				recommendation: payload.recommendation,
				...(payload.options !== undefined && { options: payload.options }),
			},
		};
		const status =
			current.frontmatter.status === "running"
				? "needs-input"
				: current.frontmatter.status;
		await writeStory({
			path: current.path,
			frontmatter: { ...current.frontmatter, status, runs },
			body: current.body,
		});
		return true;
	});
}

// The caller-owned pieces of a resume: the up-front precondition (throws, or
// names the session to resume and the prompt), the init-write re-check (the
// authority on what the claim does; undefined aborts), and the
// ILLEGAL_TRANSITION shape an aborted write rejects with.
interface ResumeSpec {
	precheck(current: Story): { session: string; prompt: string };
	recheck(fresh: Story): StoryFrontmatter | undefined;
	abort: { from: Status; reason: string };
}

function illegalTransition(from: Status, to: Status, reason: string): never {
	throw new ApiError("ILLEGAL_TRANSITION", {
		status: 409,
		message: reason,
		data: { from, to, reason },
	});
}

// The one resume shape (answer and steer). Two hazards share the single
// per-story slot: the previous process's teardown is waited out (bounded),
// and of two concurrent resumes only the first past the synchronous
// check-then-set spawns; the queued init write stays the authority on what
// the claim does.
async function resumeRun(
	storyId: string,
	spec: ResumeSpec,
): Promise<{ sessionId: string }> {
	const existing = states.get(storyId);
	if (existing !== undefined) {
		if (existing.closed === undefined || !(await closesInTime(existing))) {
			throw runActive();
		}
	}
	const known = findStory(storyId);
	// Synchronous check-then-set: no await between wait-wake and claim, so the
	// second of two concurrent resumes finds the slot taken before it spawns.
	if (states.has(storyId)) throw runActive();
	const state: RunState = {
		storyId,
		hookToken: randomUUID(),
		hookPosted: false,
		exited: false,
	};
	states.set(storyId, state);
	hookTokens.set(state.hookToken, state);
	try {
		return await resume(state, known.path, known.epicId, spec);
	} catch (error) {
		await cleanup(state);
		throw error;
	}
}

// The resume path for a needs-input card: requires a pending question on the
// open entry, resumes with the answer, and the re-check flips back to running
// with the question deleted.
export function answerRun(
	storyId: string,
	answer: string,
): Promise<{ sessionId: string }> {
	return resumeRun(storyId, {
		precheck: (current) => {
			const from = current.frontmatter.status;
			if (from !== "needs-input") {
				throw illegalTransition(
					from,
					"running",
					"only a needs-input story can be answered",
				);
			}
			const entry = current.frontmatter.runs.findLast(
				(run) => run.outcome === undefined,
			);
			const question = entry?.question;
			if (entry === undefined || question === undefined) {
				throw illegalTransition(
					from,
					"running",
					"no open run entry with a pending question",
				);
			}
			return {
				session: entry.session,
				prompt: questionAnswerPrompt(question.text, answer),
			};
		},
		recheck: (fresh) => {
			if (fresh.frontmatter.status !== "needs-input") return undefined;
			const runs = [...fresh.frontmatter.runs];
			const open = runs.findLastIndex((run) => run.outcome === undefined);
			const openRun = runs[open];
			if (openRun === undefined || openRun.question === undefined) {
				return undefined;
			}
			const { question: _answered, ...rest } = openRun;
			runs[open] = rest;
			return { ...fresh.frontmatter, status: "running", runs };
		},
		abort: {
			from: "needs-input",
			reason: "story left needs-input during the resume; the move wins",
		},
	});
}

function steerSpec(message: string): ResumeSpec {
	return {
		precheck: (current) => {
			const from = current.frontmatter.status;
			if (from !== "running") {
				throw illegalTransition(
					from,
					"running",
					"only a running story can be steered",
				);
			}
			const entry = current.frontmatter.runs.findLast(
				(run) => run.outcome === undefined,
			);
			if (entry === undefined || entry.question !== undefined) {
				throw illegalTransition(
					from,
					"running",
					"no open run entry free of a pending question",
				);
			}
			return { session: entry.session, prompt: steeringPrompt(message) };
		},
		recheck: (fresh) => {
			if (fresh.frontmatter.status !== "running") return undefined;
			const runs = [...fresh.frontmatter.runs];
			const open = runs.findLastIndex((run) => run.outcome === undefined);
			const openRun = runs[open];
			if (openRun === undefined || openRun.question !== undefined) {
				return undefined;
			}
			const { paused: _resumed, ...rest } = openRun;
			runs[open] = rest;
			return { ...fresh.frontmatter, status: "running", runs };
		},
		abort: {
			from: "running",
			reason: "story left running during the steer; the move wins",
		},
	};
}

// Steering: kill the live segment (a paused run has none), then resume the
// same session with the interruption notice plus the message. An absent
// message is the Resume button.
export async function steerRun(
	storyId: string,
	message?: string,
): Promise<{ sessionId: string }> {
	const spec = steerSpec(message ?? RESUME_MESSAGE);
	const known = findStory(storyId);
	spec.precheck(await readStoryOrApiError(known.path, known.epicId, storyId));
	const live = states.get(storyId);
	if (live !== undefined && live.closed !== undefined) {
		live.intent = "steer";
		if (live.pid !== undefined) await killProcessGroup(live.pid);
	}
	return resumeRun(storyId, spec);
}

// Pause: kill the live segment and return once its `paused: true` write
// landed. A paused run has no process, so pausing it again is rejected.
export async function pauseRun(storyId: string): Promise<void> {
	const known = findStory(storyId);
	const current = await readStoryOrApiError(known.path, known.epicId, storyId);
	const from = current.frontmatter.status;
	if (from !== "running") {
		throw illegalTransition(
			from,
			"running",
			"only a running story can be paused",
		);
	}
	const state = states.get(storyId);
	if (state === undefined || state.closed === undefined) {
		throw new ApiError("NOT_FOUND", {
			message: "no live run process to pause",
		});
	}
	state.intent = "pause";
	if (state.pid !== undefined) await killProcessGroup(state.pid);
	if (!(await closesInTime(state))) throw runActive();
}

// Stop: close the open entry blocked. A live segment (which a needs-input
// card can transiently hold during the asking process's teardown) is killed
// and closed by the intent-aware close; without one, one queued write closes
// the entry directly with the same fields. A pending question stays on the
// entry as record either way.
export async function stopRun(storyId: string): Promise<void> {
	const known = findStory(storyId);
	const current = await readStoryOrApiError(known.path, known.epicId, storyId);
	const from = current.frontmatter.status;
	if (from !== "running" && from !== "needs-input") {
		throw illegalTransition(
			from,
			"blocked",
			"only a running or needs-input story can be stopped",
		);
	}
	const state = states.get(storyId);
	if (state !== undefined) {
		if (state.closed === undefined) throw runActive();
		state.intent = "stop";
		if (state.pid !== undefined) await killProcessGroup(state.pid);
		if (!(await closesInTime(state))) throw runActive();
		return;
	}
	await enqueueWrite(async () => {
		let fresh: Story;
		try {
			fresh = await readStoryFile(known.path, known.epicId);
		} catch {
			return;
		}
		const status = fresh.frontmatter.status;
		if (status !== "running" && status !== "needs-input") return;
		const runs = [...fresh.frontmatter.runs];
		const open = runs.findLastIndex((run) => run.outcome === undefined);
		const openRun = runs[open];
		if (openRun !== undefined) {
			const { paused: _stopped, ...rest } = openRun;
			runs[open] = { ...rest, outcome: "blocked", error: STOPPED_ERROR };
		}
		await writeStory({
			path: fresh.path,
			frontmatter: { ...fresh.frontmatter, status: "blocked", runs },
			body: fresh.body,
		});
	});
}

function runActive() {
	return new ApiError("RUN_ACTIVE", {
		status: 409,
		message: "a run is already active for this story",
	});
}

// A state still unresolved at the bound means a process that asked without
// ending its turn, or a hand-typed needs-input under a live run.
async function closesInTime(state: RunState): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			(state.closed ?? Promise.resolve()).then(() => true),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), CLOSE_WAIT_MS);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function resume(
	state: RunState,
	path: string,
	epicId: string,
	spec: ResumeSpec,
): Promise<{ sessionId: string }> {
	const repo = managedRepo();
	const { storyId } = state;

	// The spawn snapshot: status, entry, question, branch, preset. The queued
	// init write below re-checks before anything lands on disk.
	const current = await readStoryOrApiError(path, epicId, storyId);
	const plan = spec.precheck(current);
	const branch = current.frontmatter.branch;
	if (branch === undefined) {
		throw new ApiError("RUN_FAILED", {
			message: "story has no branch to resume on",
		});
	}
	state.branch = branch;

	const spawn = await presetSpawn(
		current.frontmatter.preset ?? "guarded",
		repo,
	);

	// Idempotent convergence covers an out-of-band worktree delete: session
	// lookup is keyed to the cwd path, so a recreated path still resumes.
	let worktree: string;
	try {
		worktree = (await ensureWorktree({ repo, storyId, branch })).path;
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw new ApiError("RUN_FAILED", { message: errorText(error) });
	}
	state.worktree = worktree;

	const settingsPath = settingsFilePath(storyId);
	await writeFile(
		settingsPath,
		`${JSON.stringify(runSettings(worktree, state.hookToken), null, "\t")}\n`,
	);

	const handle = spawnRunSession({
		storyId,
		prompt: plan.prompt,
		cwd: worktree,
		settingsPath,
		resume: plan.session,
		...spawn,
	});
	state.pid = handle.pid;
	trackClose(state, path, epicId, handle);
	if (handle.pid !== undefined) {
		await writeFile(pidFilePath(storyId), `${handle.pid}\n`);
	}

	const init = await raceInit(handle, state);
	state.sessionId = init.sessionId;

	// Same arming contract as start(), the caller's re-check: an aborted write
	// means the user's move (or a racing ask_user) won.
	state.initWrite = enqueueWrite(async (): Promise<"armed" | "aborted"> => {
		if (state.exited) return "aborted";
		let fresh: Story;
		try {
			fresh = await readStoryFile(path, epicId);
		} catch {
			return "aborted";
		}
		const frontmatter = spec.recheck(fresh);
		if (frontmatter === undefined) return "aborted";
		await writeStory({ path: fresh.path, frontmatter, body: fresh.body });
		return "armed";
	});
	if ((await state.initWrite) !== "armed") {
		if (state.pid !== undefined) await killProcessGroup(state.pid);
		throw illegalTransition(spec.abort.from, "running", spec.abort.reason);
	}
	return { sessionId: init.sessionId };
}

// A result event's usage counts only its own turn, so entry totals add
// across segments. Absence-safe both ways: a field lands only when the entry
// or the segment observed it, so a usage-less close (hook-only, killed,
// error without usage) keeps the omission instead of writing NaN.
function addUsage(run: Run, result: SessionResult | undefined): Partial<Run> {
	const patch: Partial<Run> = {};
	if (run.tokens !== undefined || result?.tokens !== undefined) {
		patch.tokens = (run.tokens ?? 0) + (result?.tokens ?? 0);
	}
	if (run.minutes !== undefined || result?.minutes !== undefined) {
		// Re-round to one decimal: the per-segment values are already rounded,
		// so summing floats would otherwise write 0.8999… into frontmatter.
		patch.minutes =
			Math.round(((run.minutes ?? 0) + (result?.minutes ?? 0)) * 10) / 10;
	}
	return patch;
}

export function runHookPosted(token: string): boolean {
	const state = hookTokens.get(token);
	if (state === undefined) return false;
	state.hookPosted = true;
	log?.info(`run ${state.storyId}: stop-hook POST received`);
	return true;
}

async function isClaudeProcess(pid: number): Promise<boolean> {
	try {
		const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8");
		return cmdline.includes("claude");
	} catch {
		return false;
	}
}

// Boot sweep, pid files first, card status second: a hard crash can land
// anywhere in the lifecycle, including the start window where the story
// still reads `ready` with a live orphan. Defensive per story: one bad
// story never aborts boot or the rest of the sweep.
async function reconcile(): Promise<void> {
	const repo = managedRepo();
	const survivors = new Set<string>();

	let entries: string[] = [];
	try {
		entries = await readdir(worktreesDir(repo));
	} catch (error) {
		if (!isENOENT(error)) {
			log?.error(`run reconciliation: ${errorText(error)}`);
		}
	}
	for (const name of entries) {
		if (!name.endsWith(".pid")) continue;
		const storyId = name.slice(0, -".pid".length);
		const pidPath = join(worktreesDir(repo), name);
		try {
			const pid = Number((await readFile(pidPath, "utf8")).trim());
			// The cmdline check guards against pid reuse after a reboot.
			if (Number.isInteger(pid) && pid > 0 && (await isClaudeProcess(pid))) {
				if (!(await killProcessGroup(pid))) {
					survivors.add(storyId);
					log?.error(
						`run reconciliation: process group ${pid} (story ${storyId}) survived SIGKILL`,
					);
				}
			}
			await rm(pidPath, { force: true });
		} catch (error) {
			log?.error(`run reconciliation: pid file ${name}: ${errorText(error)}`);
		}
	}

	for (const story of boardSnapshot().stories) {
		if (story.frontmatter.status !== "running") continue;
		try {
			await reconcileRunning(story, survivors.has(story.id));
		} catch (error) {
			log?.error(`run reconciliation: story ${story.id}: ${errorText(error)}`);
		}
	}
}

async function reconcileRunning(
	story: Story,
	groupSurvived: boolean,
): Promise<void> {
	// A paused run is `running` on disk with no process by design: its
	// segment's safety commit ran at pause time, so the story is left intact
	// and Resume still works after the restart.
	const openEntry = story.frontmatter.runs.findLast(
		(run) => run.outcome === undefined,
	);
	if (openEntry?.paused === true) return;
	const repo = managedRepo();
	const worktree = worktreePath(repo, story.id);
	// The crash-path safety commit: the close handler that normally commits
	// leftovers no longer exists, and the Stop hook does not fire on SIGTERM.
	// A surviving group skips it (the tree may still be moving); the next
	// reuse check retries.
	if (!groupSurvived && (await worktreeExists(worktree))) {
		try {
			await safetyCommit(worktree);
		} catch (error) {
			log?.error(
				`run reconciliation: safety commit for ${story.id} failed: ${errorText(error)}`,
			);
		}
	}
	const parked = await enqueueWrite(async () => {
		const current = await readStoryFile(story.path, story.epicId);
		if (current.frontmatter.status !== "running") return false;
		const runs = [...current.frontmatter.runs];
		// A hand-typed `running` with no open entry parks without inventing one.
		const open = runs.findLastIndex((run) => run.outcome === undefined);
		const openRun = runs[open];
		if (openRun !== undefined) {
			runs[open] = { ...openRun, outcome: "blocked", error: RESTART_ERROR };
		}
		await writeStory({
			path: current.path,
			frontmatter: { ...current.frontmatter, status: "blocked", runs },
			body: current.body,
		});
		return true;
	});
	if (parked) log?.info(`run reconciliation: parked ${story.id} in blocked`);
}

export default defineService({
	name: "runs",
	start: async (ctx) => {
		log = ctx.log;
		await reconcile();
		return () => {
			states.clear();
			hookTokens.clear();
			log = undefined;
		};
	},
});
