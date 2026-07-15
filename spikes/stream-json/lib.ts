import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";

// Minimal shapes for the events the spike relies on; everything else passes
// through as unknown.
const eventSchema = z
	.object({
		type: z.string(),
		subtype: z.string().optional(),
		session_id: z.string().optional(),
		result: z.string().optional(),
		is_error: z.boolean().optional(),
	})
	.passthrough();

export type StreamEvent = z.infer<typeof eventSchema>;

export interface ClaudeRunResult {
	events: StreamEvent[];
	sessionId: string | undefined;
	resultText: string | undefined;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
}

export interface ClaudeRunOptions {
	cwd: string;
	prompt: string;
	args?: string[];
	env?: Record<string, string>;
	// Resolves with the pid once the process starts; lets callers kill mid-run.
	onSpawn?: (pid: number) => void;
	onEvent?: (event: StreamEvent) => void;
	timeoutMs?: number;
}

// Nested-session and API-key vars would change auth or confuse the child CLI.
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (key.startsWith("CLAUDE")) continue;
		if (key.startsWith("ANTHROPIC")) continue;
		env[key] = value;
	}
	return { ...env, ...extra };
}

export async function runClaude(
	options: ClaudeRunOptions,
): Promise<ClaudeRunResult> {
	const {
		cwd,
		prompt,
		args = [],
		env = {},
		onSpawn,
		onEvent,
		timeoutMs = 180_000,
	} = options;

	const child = spawn(
		"claude",
		[
			"-p",
			prompt,
			"--output-format",
			"stream-json",
			"--verbose",
			"--model",
			"haiku",
			...args,
		],
		{ cwd, env: cleanEnv(env), stdio: ["ignore", "pipe", "pipe"] },
	);
	if (child.pid !== undefined) onSpawn?.(child.pid);

	const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

	const events: StreamEvent[] = [];
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});

	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		if (line.trim() === "") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			console.error(`[non-json line] ${line.slice(0, 200)}`);
			return;
		}
		const event = eventSchema.safeParse(parsed);
		if (!event.success) {
			console.error(`[unrecognized event] ${line.slice(0, 200)}`);
			return;
		}
		events.push(event.data);
		onEvent?.(event.data);
	});

	const [exitCode, signal] = (await once(child, "close")) as [
		number | null,
		NodeJS.Signals | null,
	];
	clearTimeout(timer);

	const result = events.find((event) => event.type === "result");
	const sessionId =
		result?.session_id ??
		events.find((event) => event.session_id !== undefined)?.session_id;

	return {
		events,
		sessionId,
		resultText: result?.result,
		exitCode,
		signal,
		stderr,
	};
}

export function summarize(run: ClaudeRunResult): string {
	const counts = new Map<string, number>();
	for (const event of run.events) {
		const key = event.subtype ? `${event.type}/${event.subtype}` : event.type;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const countText = [...counts.entries()]
		.map(([key, n]) => `${key}×${n}`)
		.join(" ");
	return [
		`  exit=${run.exitCode} signal=${run.signal ?? "none"}`,
		`  session=${run.sessionId}`,
		`  events: ${countText}`,
		`  result: ${run.resultText?.slice(0, 200) ?? "<none>"}`,
	].join("\n");
}

export const TOY_REPO = new URL("./toy-repo/", import.meta.url).pathname;

export function setupToyRepo(): void {
	if (existsSync(TOY_REPO)) return;
	mkdirSync(TOY_REPO, { recursive: true });
	writeFileSync(
		`${TOY_REPO}/math.js`,
		"export function add(a, b) {\n\treturn a + b;\n}\n",
	);
	writeFileSync(`${TOY_REPO}/README.md`, "# Toy repo\nSpike target.\n");
	execFileSync("git", ["init", "-q", "-b", "master"], { cwd: TOY_REPO });
	execFileSync("git", ["add", "-A"], { cwd: TOY_REPO });
	execFileSync(
		"git",
		[
			"-c",
			"user.email=spike@local",
			"-c",
			"user.name=spike",
			"commit",
			"-qm",
			"init",
		],
		{ cwd: TOY_REPO },
	);
}
