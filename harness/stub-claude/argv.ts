import { z } from "@fcalell/plugin-api/schema";
import {
	KIND_REGISTRY,
	MCP_SERVER_NAME,
	type SessionKind,
	sessionKindSchema,
} from "../../src/sessions/kinds.ts";

// Nothing on the command line names the session kind: the MCP token is a bare
// uuid and the kind lives server-side. The kind's board tools do ride
// `--allowedTools` (`src/sessions/runner.ts:132-136`), and the set of them is
// distinct for every spawnable kind, so the set is the identity.
function boardToolKey(names: readonly string[]): string {
	return [...new Set(names)].sort().join(",");
}

const KIND_BY_BOARD_TOOLS = new Map<string, SessionKind>();
for (const [kind, row] of Object.entries(KIND_REGISTRY)) {
	if (row.boardTools === undefined) continue;
	const key = boardToolKey(row.boardTools);
	const clash = KIND_BY_BOARD_TOOLS.get(key);
	if (clash !== undefined) {
		throw new Error(
			`session kinds ${clash} and ${kind} share the board tools [${key}]; the stub cannot tell their spawns apart`,
		);
	}
	KIND_BY_BOARD_TOOLS.set(key, sessionKindSchema.parse(kind));
}

const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

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

// Every spawn carries an MCP url (`src/server/services/sessions.ts:330`), so a
// kind with no board tools reads as an empty set rather than as a missing one.
export function kindOf(
	allowedTools: readonly string[],
): SessionKind | undefined {
	const boardTools = allowedTools
		.filter((tool) => tool.startsWith(MCP_PREFIX))
		.map((tool) => tool.slice(MCP_PREFIX.length));
	return KIND_BY_BOARD_TOOLS.get(boardToolKey(boardTools));
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
