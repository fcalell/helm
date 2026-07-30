import { z } from "@fcalell/plugin-api/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// No branch of a board-tool call throws: a refusal resolves with
// `isError: true` and a success carries `isError: undefined`.
// These two refusals are the `adversarySessionId` race, which the stub cannot
// observe (`src/server/services/gate.ts:355-365`); every other text is a
// scenario bug and fails the spawn.
const RETRYABLE_REFUSALS = [
	"session is not initialized yet",
	"no adversary round is running for this story",
];

const BACKOFF_MS = [50, 100, 200, 400, 800, 1600, 1600, 1600];

const contentSchema = z.array(
	z.looseObject({ type: z.string(), text: z.string().optional() }),
);

export type CallOutcome = { ok: true } | { ok: false; text: string };

export interface ToolClientOptions {
	url: string;
	onCall(tool: string, attempt: number): void;
	onRefusal(tool: string, text: string, retrying: boolean): void;
}

export interface ToolClient {
	call(tool: string, payload: Record<string, unknown>): Promise<CallOutcome>;
	close(): Promise<void>;
}

function textOf(content: unknown): string {
	const parsed = contentSchema.safeParse(content);
	if (!parsed.success) return JSON.stringify(content);
	return parsed.data
		.map((part) => part.text ?? "")
		.join(" ")
		.trim();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectToolClient(
	options: ToolClientOptions,
): Promise<ToolClient> {
	const client = new Client({ name: "stub-claude", version: "0.0.0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(options.url)));
	return {
		async call(tool, payload) {
			for (let attempt = 0; ; attempt += 1) {
				options.onCall(tool, attempt + 1);
				const result = await client.callTool({
					name: tool,
					arguments: payload,
				});
				if (result.isError !== true) return { ok: true };
				const text = textOf(result.content);
				const delay = BACKOFF_MS[attempt];
				const retrying =
					delay !== undefined &&
					RETRYABLE_REFUSALS.some((refusal) => text.includes(refusal));
				options.onRefusal(tool, text, retrying);
				if (!retrying) return { ok: false, text };
				await sleep(delay);
			}
		},
		close: () => client.close(),
	};
}
