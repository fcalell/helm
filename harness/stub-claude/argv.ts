import { z } from "@fcalell/plugin-api/schema";

export const stubRoleSchema = z.enum(["adversary", "refine"]);
export type StubRole = z.infer<typeof stubRoleSchema>;

// Nothing on the command line names the session kind: the MCP token is a bare
// uuid and the kind lives server-side. The kind's board tools do ride
// `--allowedTools` (`src/sessions/runner.ts:132-136`), and these two are
// unique to their row (`src/sessions/kinds.ts:207-211`, `:224`).
const ROLE_MARKERS = {
	adversary: "mcp__helm__flag_risk",
	refine: "mcp__helm__update_brief",
} as const satisfies Record<StubRole, string>;

export const parsedArgvSchema = z.object({
	prompt: z.string().optional(),
	outputFormat: z.string().optional(),
	verbose: z.boolean(),
	includePartialMessages: z.boolean(),
	model: z.string().optional(),
	effort: z.string().optional(),
	permissionMode: z.string().optional(),
	allowedTools: z.array(z.string()),
	tools: z.array(z.string()),
	systemPrompt: z.string().optional(),
	strictMcpConfig: z.boolean(),
	mcpConfig: z.string().optional(),
	settings: z.string().optional(),
	permissionPromptTool: z.string().optional(),
	resume: z.string().optional(),
	// Anything the parser did not place: a runner change shows up here
	// instead of silently vanishing.
	unknown: z.array(z.string()),
});
export type ParsedArgv = z.infer<typeof parsedArgvSchema>;

// `--tools` is a spread of N bare values (`runner.ts:155-156`), so it ends at
// the next flag rather than after one value.
export function parseArgv(argv: readonly string[]): ParsedArgv {
	const parsed: ParsedArgv = {
		verbose: false,
		includePartialMessages: false,
		strictMcpConfig: false,
		allowedTools: [],
		tools: [],
		unknown: [],
	};
	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		const value = argv[i + 1];
		switch (flag) {
			case "--verbose":
				parsed.verbose = true;
				break;
			case "--include-partial-messages":
				parsed.includePartialMessages = true;
				break;
			case "--strict-mcp-config":
				parsed.strictMcpConfig = true;
				break;
			case "--allowedTools":
				parsed.allowedTools = value === undefined ? [] : value.split(",");
				i += 1;
				break;
			case "--tools":
				while (i + 1 < argv.length) {
					const next = argv[i + 1];
					if (next === undefined || next.startsWith("-")) break;
					parsed.tools.push(next);
					i += 1;
				}
				break;
			case "-p":
				parsed.prompt = value;
				i += 1;
				break;
			case "--output-format":
				parsed.outputFormat = value;
				i += 1;
				break;
			case "--model":
				parsed.model = value;
				i += 1;
				break;
			case "--effort":
				parsed.effort = value;
				i += 1;
				break;
			case "--permission-mode":
				parsed.permissionMode = value;
				i += 1;
				break;
			case "--system-prompt":
				parsed.systemPrompt = value;
				i += 1;
				break;
			case "--mcp-config":
				parsed.mcpConfig = value;
				i += 1;
				break;
			case "--settings":
				parsed.settings = value;
				i += 1;
				break;
			case "--permission-prompt-tool":
				parsed.permissionPromptTool = value;
				i += 1;
				break;
			case "--resume":
				parsed.resume = value;
				i += 1;
				break;
			default:
				if (flag !== undefined) parsed.unknown.push(flag);
		}
	}
	return parsed;
}

export function roleOf(allowedTools: readonly string[]): StubRole | undefined {
	for (const [role, marker] of Object.entries(ROLE_MARKERS)) {
		if (allowedTools.includes(marker)) return stubRoleSchema.parse(role);
	}
	return undefined;
}

const mcpConfigSchema = z.object({
	mcpServers: z.record(z.string(), z.object({ url: z.string().min(1) })),
});

export function mcpUrlOf(mcpConfig: string | undefined): string | undefined {
	if (mcpConfig === undefined) return undefined;
	let json: unknown;
	try {
		json = JSON.parse(mcpConfig);
	} catch {
		return undefined;
	}
	const parsed = mcpConfigSchema.safeParse(json);
	if (!parsed.success) return undefined;
	return parsed.data.mcpServers.helm?.url;
}
