import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
	parseInitEvent,
	type SessionEvent,
	type SessionInit,
	sessionEventSchema,
} from "./events.ts";
import { MCP_SERVER_NAME, type SessionKind, spawnableRow } from "./kinds.ts";

export interface SpawnSessionOptions {
	kind: SessionKind;
	cwd: string;
	prompt: string;
	// Session id to resume; omit to start a fresh session.
	resume?: string;
	// Per-spawn context appended after the kind's system prompt (e.g. the
	// refine seed: epic conclusions + the card).
	seedSystemPrompt?: string;
	// The orchestrator's per-spawn MCP endpoint; set enables the kind's board
	// tools. Omit to run standalone with only the read-only allowlist.
	mcpUrl?: string;
	// Per-spawn settings file (`--settings`): run spawns carry the Stop hook
	// and the `.helm/` deny rules there.
	settingsPath?: string;
	// Replaces the kind row's `tools` (the run presets compute the effective
	// allowlist per spawn); board tools still append from the row.
	tools?: readonly string[];
	// Per-spawn additions to `--allowedTools` (the repo's check-command
	// patterns); the registry constant cannot see runtime config.
	extraTools?: readonly string[];
	// Tool id for `--permission-prompt-tool`: non-allowlisted mutating calls
	// consult it instead of failing on the missing terminal prompt.
	permissionPromptTool?: string;
	// Merged over the inherited environment (e.g. MCP_TOOL_TIMEOUT for held
	// permission approvals).
	env?: Record<string, string>;
	// Spawn the child as its own process-group leader, so a group kill can
	// reach the tool subprocesses it spawned; single-pid SIGTERM would miss
	// them.
	detached?: boolean;
	onEvent?: (event: SessionEvent) => void;
}

export interface SessionOutcome {
	sessionId: string | undefined;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	// A resume whose transcript is gone: exit 1 + the CLI's loud stderr line.
	stale: boolean;
	stderr: string;
}

export interface SessionProcess {
	pid: number | undefined;
	// Resolves with `system/init`; rejects (SessionSpawnError) if the process
	// dies first, which is how a stale resume surfaces.
	started: Promise<SessionInit>;
	done: Promise<SessionOutcome>;
	kill(): void;
}

export class SessionSpawnError extends Error {
	readonly stale: boolean;
	readonly exitCode: number | null;
	readonly stderr: string;

	constructor(outcome: SessionOutcome) {
		const detail = outcome.stderr.trim().split("\n").at(-1) ?? "";
		super(
			outcome.stale
				? `stale session: ${detail}`
				: `claude exited (code ${outcome.exitCode}, signal ${outcome.signal}) before system/init: ${detail}`,
		);
		this.name = "SessionSpawnError";
		this.stale = outcome.stale;
		this.exitCode = outcome.exitCode;
		this.stderr = outcome.stderr;
	}
}

const STALE_STDERR = "No conversation found with session ID";

// ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN outrank subscription auth, and the
// nested-session markers make the child CLI believe it runs inside another
// Claude Code session; CLAUDE_CODE_OAUTH_TOKEN must survive for headless
// hosts.
const STRIPPED_ENV = new Set([
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"CLAUDECODE",
	"CLAUDE_CODE_ENTRYPOINT",
]);

function sessionEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined || STRIPPED_ENV.has(key)) continue;
		env[key] = value;
	}
	return env;
}

export function spawnSessionProcess(
	options: SpawnSessionOptions,
): SessionProcess {
	const row = spawnableRow(options.kind);
	const allowedTools = [
		...(options.tools ?? row.tools),
		...(options.extraTools ?? []),
	];
	if (options.mcpUrl !== undefined) {
		allowedTools.push(
			...row.boardTools.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`),
		);
	}
	const args = [
		"-p",
		options.prompt,
		// stream-json requires --verbose under -p.
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--model",
		row.model,
		"--effort",
		row.effort,
		// Explicit: the user's own config may default to a laxer mode (`auto`),
		// which would execute tools outside the kind's allowlist.
		"--permission-mode",
		"default",
		"--allowedTools",
		allowedTools.join(","),
		"--append-system-prompt",
		options.seedSystemPrompt === undefined
			? row.systemPrompt
			: `${row.systemPrompt}\n\n${options.seedSystemPrompt}`,
		// Without it the user's global MCP servers load into every session.
		"--strict-mcp-config",
	];
	if (options.mcpUrl !== undefined) {
		const mcpConfig = JSON.stringify({
			mcpServers: {
				[MCP_SERVER_NAME]: { type: "http", url: options.mcpUrl },
			},
		});
		args.push("--mcp-config", mcpConfig);
	}
	if (options.settingsPath !== undefined) {
		args.push("--settings", options.settingsPath);
	}
	if (options.permissionPromptTool !== undefined) {
		args.push("--permission-prompt-tool", options.permissionPromptTool);
	}
	if (options.resume !== undefined) args.push("--resume", options.resume);

	const child = spawn("claude", args, {
		cwd: options.cwd,
		env: { ...sessionEnv(), ...options.env },
		stdio: ["ignore", "pipe", "pipe"],
		detached: options.detached === true,
	});

	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});

	let init: SessionInit | undefined;
	const {
		promise: started,
		resolve: resolveStarted,
		reject: rejectStarted,
	} = Promise.withResolvers<SessionInit>();
	// A caller may only await `done` (e.g. after kill); the rejection must not
	// escape as an unhandled one.
	started.catch(() => {});

	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		if (line.trim() === "") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return;
		}
		const event = sessionEventSchema.safeParse(parsed);
		if (!event.success) return;
		if (init === undefined) {
			init = parseInitEvent(event.data);
			if (init !== undefined) resolveStarted(init);
		}
		options.onEvent?.(event.data);
	});

	const done = (async (): Promise<SessionOutcome> => {
		const [exitCode, signal] = (await once(child, "close")) as [
			number | null,
			NodeJS.Signals | null,
		];
		const outcome: SessionOutcome = {
			sessionId: init?.sessionId,
			exitCode,
			signal,
			stale: exitCode === 1 && stderr.includes(STALE_STDERR),
			stderr,
		};
		if (init === undefined) rejectStarted(new SessionSpawnError(outcome));
		return outcome;
	})();

	return {
		pid: child.pid,
		started,
		done,
		kill: () => {
			child.kill("SIGTERM");
		},
	};
}
