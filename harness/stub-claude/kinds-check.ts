import {
	KIND_REGISTRY,
	MCP_SERVER_NAME,
	type SessionKind,
} from "../../src/sessions/kinds.ts";
import { kindOf } from "./argv.ts";

// Proves the stub's inference over the registry it derives from: every
// spawnable kind's own `--allowedTools` must resolve back to that kind.
let failed = false;
for (const [kind, row] of Object.entries(KIND_REGISTRY)) {
	if (row.boardTools === undefined || row.tools === undefined) {
		console.log(`${kind.padEnd(9)} not spawnable`);
		continue;
	}
	const allowedTools = [
		...row.tools,
		...row.boardTools.map((tool) => `mcp__${MCP_SERVER_NAME}__${tool}`),
	];
	const resolved = kindOf(allowedTools);
	const ok = resolved === (kind as SessionKind);
	if (!ok) failed = true;
	console.log(`${kind.padEnd(9)} ${ok ? "ok" : `MISMATCH ${resolved}`}`);
}
process.exitCode = failed ? 1 : 0;
