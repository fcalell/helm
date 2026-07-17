import type { SessionKind } from "../../sessions/kinds.ts";
import type { Attach } from "../services/sessions.ts";

// One spawn token per session process. Caller identity rides the transport:
// the CLI reaches `/mcp/<token>`, so every tool call resolves to this binding
// server-side and payloads never carry ids.
export interface SpawnBinding {
	kind: SessionKind;
	attach?: Attach;
	// Set once the session's `system/init` reports its id.
	sessionId?: string;
}

const bindings = new Map<string, SpawnBinding>();
let port: number | undefined;

export function setMcpPort(p: number): void {
	port = p;
}

export function mcpEndpointUrl(token: string): string {
	if (port === undefined) throw new Error("MCP port is not set");
	return `http://127.0.0.1:${port}/mcp/${token}`;
}

export function registerSpawn(
	token: string,
	binding: { kind: SessionKind; attach?: Attach },
): void {
	bindings.set(token, { kind: binding.kind, attach: binding.attach });
}

export function bindSessionId(token: string, sessionId: string): void {
	const binding = bindings.get(token);
	if (binding !== undefined) binding.sessionId = sessionId;
}

export function releaseSpawn(token: string): void {
	bindings.delete(token);
}

export function lookupSpawn(token: string): SpawnBinding | undefined {
	return bindings.get(token);
}
