# Implementation plan: 001-02 board tools (in-process MCP server & proposals)

Technical plan for `.helm/board/epics/001-session-foundation/02-board-tools.md`. Every structural
decision the story's Approach leaves open is settled here; implementation is mechanical execution.
Library facts below were re-verified against current docs (context7 / npm) on 2026-07-17.

## Decisions the Approach left open

1. **Stack raw-mount shape.** `ServiceContext` gains `http: ServiceHttp` with `port` and
   `mount(prefix, handler)`, where `handler` is fetch-style (`(request: Request) => Response |
   Promise<Response>`). A dispatcher middleware in `create-node-server.ts`, registered after `/ws`
   and before the worker mounts, routes by longest matching prefix. Fetch-style keeps Hono out of
   the consumer-facing service surface; `port` is required because the spawned CLI must reach the
   node server directly (never through the vite dev proxy).
2. **Transport library.** `@hono/mcp` (v0.3.1, the honojs middleware package) provides
   `StreamableHTTPTransport`, whose `handleRequest(c)` takes a Hono context and returns a fetch
   `Response`. Its peers match what Helm already has: `@modelcontextprotocol/sdk` ^1.29.0 (the
   spike-verified version, still latest) and zod 4 (the stack's `z`). Helm builds a small Hono
   sub-app for `/mcp/:token` and mounts its `fetch` via `ctx.http.mount`. Fresh `McpServer` plus
   fresh transport per request, the spike-verified stateless pattern.
3. **Module layout.** `src/server/mcp/` holds `registry.ts` (spawn tokens + port), `schemas.ts`
   (pure-zod payload and wire schemas, "next to the tools", importable from the browser bundle),
   `tools.ts` (tool table + handlers), `server.ts` (per-request `McpServer` construction). Two new
   services: `src/server/services/mcp.ts` (the HTTP mount) and `src/server/services/proposals.ts`
   (store, `proposal` WS channel, resolution, deferred resumes). Import graph is acyclic:
   sessions → mcp/registry; mcp service → mcp/server → mcp/tools → proposals service → sessions
   service.
4. **Proposal model.** A tool call records one `Proposal` with `items[]`. `propose_epics` and
   `propose_stories` are multi-item (one item per epic/story, per-item resolution as define-refine
   specifies); `update_brief`, `resolve_question`, `raise_decision`, `flag_risk` are single-item.
   `ask_user` is not a proposal: it records a separate `Question` (answer lifecycle, not
   accept/edit/reject).
5. **Questions and proposals share one WS channel.** New `proposal` channel with a single server
   message `snapshot: { proposals, questions }`, sent on subscribe and rebroadcast on every change
   (the board-channel pattern; the pending set is small and a missed frame is irrelevant).
6. **Resolution semantics.** One RPC call per item. Accept and edit perform the item's board write
   inside the write queue before the item is marked resolved (a failed write leaves it pending and
   the RPC errors). When the last item resolves and any item was edited or rejected, the outcomes
   batch into one resume message; an all-accepted proposal triggers no resume. If the session is
   mid-turn at that moment, the resume is held and flushed on the session's `closed` event.
7. **Edit outcome.** An edit carries a full replacement payload (validated against the tool's item
   schema in the handler) plus an optional note; the edited payload is written like an accept and
   the edit is relayed in the resume message.
8. **Recorded-only tools.** `raise_decision`: accept returns `UNSUPPORTED_RESOLUTION` (its write
   lands with 001-04); edit/reject take the generic resume path. `flag_risk`: every outcome
   returns `UNSUPPORTED_RESOLUTION` (its resolution semantics land with 001-06, and the adversary
   is never resumed). Both record, validate, and broadcast normally.
9. **Ordinal minting.** `src/board/ordinals.ts` mints one above the highest ordinal ever used:
   max over the live tree and `git log --diff-filter=A --no-renames --name-only` over
   `.helm/board/epics/` (`--no-renames` so a renamed path still counts as an add). Stories mint the
   same way, scoped to `<NNN>-*/` directories of the target epic, because board-storage retires
   story ordinals too. Minting runs inside the same write-queue task as the write. A git failure
   throws (managed repos are git repos; falling back silently could reuse an ordinal).
10. **Target epic for shape's `propose_stories`.** The payload names the epic by `slug` (required
    for `shape`, forbidden for `define`, whose session is bound to its epic). A slug is content,
    not identity, so "tool payloads never carry ids" holds literally; the server resolves slug →
    epic and errors on zero or multiple matches, at call time and again at accept time.
11. **`depends` in story drafts** are sibling slugs. Accept resolves each against (a) items of the
    same proposal already accepted into this epic, then (b) existing stories in the target epic;
    an unresolvable reference fails the accept with `BAD_REQUEST` naming the missing sibling, so
    acceptance order follows dependency order and nothing is dropped silently.
12. **Generated bodies are hardcoded builders** in `src/board/markdown.ts` (story body with the six
    template headings, epic body with title + goal + rationale). The template override machinery
    (`.helm/templates/`) is separate future work; templates.md already records the model.
13. **`ask_user` goes to every spawnable kind**, including the cold ones (`research`,
    `adversary`), per the story. Answering a cold kind's question fails with the existing
    `SESSION_COLD`; acceptable until 001-06 reworks the adversary flow. Noted, not hidden.
14. **Kind → board-tool names** live in `src/sessions/kinds.ts` (`boardTools` on `KindRow`), names
    only; the server-side tool table is `Record<BoardToolName, …>` so the compiler enforces every
    name has a definition.

## Part A: stack extension (`../stack`, plugin-node)

Follow the stack's own playbooks (`conventions.md`, `plugin-authoring.md`, `testing.md`) when
implementing; `pnpm check && pnpm test` in `../stack` gates the change.

### `plugins/node/src/server/service.ts`

```ts
export interface ServiceHttp {
	// The port the node server listens on (fixed from config before listen).
	port: number;
	// Route every request whose path equals `prefix` or starts with
	// `prefix + "/"` to `handler`. Longest registered prefix wins; an exact
	// duplicate prefix throws. Paths are not rewritten.
	mount(
		prefix: string,
		handler: (request: Request) => Response | Promise<Response>,
	): void;
}

export interface ServiceContext {
	log: ServiceLogger;
	ws: WsHub;
	http: ServiceHttp;
}
```

### `plugins/node/src/server/create-node-server.ts`

- `const mounts = new Map<string, (request: Request) => Response | Promise<Response>>()`.
- `mount(prefix, handler)`: validate `prefix` starts with `/`, has no trailing slash, is not `/`;
  throw on duplicate key.
- Dispatcher middleware registered immediately after the `/ws` route (so `/ws` always wins and
  mounts precede worker/static/SPA):

```ts
app.use("*", async (c, next) => {
	const handler = matchMount(c.req.path); // longest prefix: path === p || path.startsWith(p + "/")
	if (handler) return handler(c.req.raw);
	await next();
});
```

- `startServices` passes `{ log, ws: hub, http: { port, mount } }`.
- A consumer mounting a worker prefix (`/rpc`) would shadow it; document, don't guard.

### Tests (`create-node-server.test.ts`, follow existing style)

- A service's mounted handler receives GET and POST under its prefix (`/mcp` and `/mcp/abc/def`),
  and the request path is unrewritten.
- `/mcpx` falls through past a `/mcp` mount (SPA/404 behavior unchanged).
- Longest prefix wins when two mounts nest; duplicate prefix throws; invalid prefix throws.
- `ctx.http.port` equals the configured port.

### Docs

`.knowledge/architecture/runtime.md` §Node target: extend the service sentence to
`{ log, ws, http }` and one line on `http.mount`/`http.port`.

## Part B: Helm dependencies

`package.json` additions (then `pnpm install`):

```
"@hono/mcp": "^0.3.1",
"@modelcontextprotocol/sdk": "^1.29.0",
"hono": "^4.12.23"        // @hono/mcp peer; matches the stack's version
```

## Part C: session kinds and runner

### `src/sessions/kinds.ts`

```ts
export const BOARD_TOOLS = [
	"propose_epics",
	"propose_stories",
	"raise_decision",
	"update_brief",
	"resolve_question",
	"flag_risk",
	"ask_user",
] as const;
export const boardToolNameSchema = z.enum(BOARD_TOOLS);
export type BoardToolName = z.infer<typeof boardToolNameSchema>;

export const MCP_SERVER_NAME = "helm"; // tool ids on the CLI: mcp__helm__<tool>
```

`KindRow` gains `boardTools?: readonly BoardToolName[]` (present exactly when `tools` is);
`SpawnableKindRow` requires it. Registry values:

| kind      | boardTools                                                  |
| --------- | ----------------------------------------------------------- |
| init      | `["ask_user"]` (`propose_scaffold` is v2)                    |
| shape     | `["propose_epics", "propose_stories", "raise_decision", "ask_user"]` |
| research  | `["ask_user"]`                                               |
| define    | `["propose_stories", "ask_user"]`                            |
| refine    | `["update_brief", "resolve_question", "ask_user"]`           |
| adversary | `["flag_risk", "ask_user"]`                                  |

Replace `WORK_READ_ONLY`:

```ts
const WORK_READ_ONLY =
	"Work read-only: never edit files, never run commands. " +
	"Structured output goes through your board tools: each call records a " +
	"proposal the user resolves, so call a tool instead of pasting structure " +
	"into prose. To ask the user something, call ask_user and end your turn.";
```

### `src/sessions/runner.ts`

`SpawnSessionOptions` gains `mcpUrl?: string`. When set:

```ts
const mcpConfig = JSON.stringify({
	mcpServers: { [MCP_SERVER_NAME]: { type: "http", url: options.mcpUrl } },
});
// args additions:
"--mcp-config", mcpConfig,           // --strict-mcp-config is already passed
// --allowedTools becomes:
[...row.tools, ...row.boardTools.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`)].join(",")
```

Without `mcpUrl` the allowlist stays `row.tools` (keeps the runner usable standalone).

### `src/sessions/prompts.ts`

```ts
// Batched outcomes for one fully resolved proposal; called only when at
// least one item was edited or rejected.
export function proposalOutcomePrompt(
	tool: BoardToolName,
	items: Array<{ summary: string; outcome: "accept" | "edit" | "reject"; detail?: string }>,
): string;
// -> "The user resolved your <tool> proposal:\n- <summary>: accepted\n- <summary>: rejected: <reason>\n- <summary>: accepted with edits: <note or edited-payload JSON>\nAddress the rejections and edits before proposing again."

export function questionAnswerPrompt(question: string, answer: string): string;
// -> "The user answered your question.\nQuestion: <question>\nAnswer: <answer>"
```

## Part D: MCP module (`src/server/mcp/`)

### `registry.ts` (spawn tokens + endpoint URLs)

```ts
import type { Attach } from "../services/sessions.ts"; // export Attach there (type-only import)

export interface SpawnBinding {
	kind: SessionKind;
	attach?: Attach;
	sessionId?: string; // set once system/init reports it
}

const bindings = new Map<string, SpawnBinding>();
let port: number | undefined;

export function setMcpPort(p: number): void;
export function mcpEndpointUrl(token: string): string; // `http://127.0.0.1:${port}/mcp/${token}`; throws if port unset
export function registerSpawn(token: string, binding: { kind: SessionKind; attach?: Attach }): void;
export function bindSessionId(token: string, sessionId: string): void;
export function releaseSpawn(token: string): void;
export function lookupSpawn(token: string): SpawnBinding | undefined;
```

### `schemas.ts` (pure zod; no node imports — the SPA bundle reaches it via channels.ts)

```ts
const slugSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slugs are lowercase words joined by hyphens")
	.max(50);

export const storyDraftSchema = z.object({
	slug: slugSchema,
	title: z.string().min(1),
	goal: z.string().min(1),
	depends: z.array(slugSchema).default([]), // sibling slugs, resolved at accept
});
export type StoryDraft = z.infer<typeof storyDraftSchema>;

export const epicDraftSchema = z.object({
	slug: slugSchema,
	title: z.string().min(1),
	goal: z.string().min(1),
	rationale: z.string().optional(),
	stories: z.array(storyDraftSchema).default([]), // a shaping proposal may carry draft stories
});
export type EpicDraft = z.infer<typeof epicDraftSchema>;

export const proposeEpicsPayloadSchema = z.object({ epics: z.array(epicDraftSchema).min(1) });
// Two variants of propose_stories: shape names the target epic by slug,
// define is bound to its epic and must not name one.
export const proposeStoriesShapePayloadSchema = z.object({
	epic: slugSchema,
	stories: z.array(storyDraftSchema).min(1),
});
export const proposeStoriesDefinePayloadSchema = z.object({
	stories: z.array(storyDraftSchema).min(1),
});
export const updateBriefPayloadSchema = z.object({
	section: z.enum(BRIEF_SECTIONS),
	content: z.string().min(1),
});
export const resolveQuestionPayloadSchema = z.object({
	question: z.string().min(1), // exact text of an unchecked Open questions item
	answer: z.string().min(1),
});
export const raiseDecisionPayloadSchema = z.object({
	decision: z.string().min(1),
	context: z.string().optional(),
	settledBy: z.enum(["human", "research"]),
});
export const flagRiskPayloadSchema = z.object({
	title: z.string().min(1),
	detail: z.string().min(1),
});
export const askUserPayloadSchema = z.object({
	question: z.string().min(1),
	recommendation: z.string().min(1), // the grilling contract: always carry a recommended answer
	options: z.array(z.string().min(1)).max(6).optional(),
});
```

Wire shapes (same file):

```ts
export const proposalResolutionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("accept") }),
	z.object({ type: z.literal("edit"), payload: z.unknown(), note: z.string().optional() }),
	z.object({ type: z.literal("reject"), reason: z.string().min(1) }),
]);
export type ProposalResolution = z.infer<typeof proposalResolutionSchema>;

const proposalBase = {
	id: z.uuid(),
	sessionId: z.uuid(),
	kind: sessionKindSchema,
	createdAt: z.iso.datetime(),
};
function itemsOf<S extends z.ZodType>(payload: S) {
	return z.array(z.object({ payload, resolution: proposalResolutionSchema.optional() })).min(1);
}
export const proposalSchema = z.discriminatedUnion("tool", [
	z.object({ ...proposalBase, tool: z.literal("propose_epics"), items: itemsOf(epicDraftSchema) }),
	z.object({
		...proposalBase,
		tool: z.literal("propose_stories"),
		epic: slugSchema.optional(), // present when a shape session named the target
		items: itemsOf(storyDraftSchema),
	}),
	z.object({ ...proposalBase, tool: z.literal("update_brief"), items: itemsOf(updateBriefPayloadSchema) }),
	z.object({ ...proposalBase, tool: z.literal("resolve_question"), items: itemsOf(resolveQuestionPayloadSchema) }),
	z.object({ ...proposalBase, tool: z.literal("raise_decision"), items: itemsOf(raiseDecisionPayloadSchema) }),
	z.object({ ...proposalBase, tool: z.literal("flag_risk"), items: itemsOf(flagRiskPayloadSchema) }),
]);
export type Proposal = z.infer<typeof proposalSchema>;

export const questionSchema = z.object({
	id: z.uuid(),
	sessionId: z.uuid(),
	kind: sessionKindSchema,
	createdAt: z.iso.datetime(),
	...askUserPayloadSchema.shape,
});
export type Question = z.infer<typeof questionSchema>;

export const proposalSnapshotSchema = z.object({
	proposals: z.array(proposalSchema),
	questions: z.array(questionSchema),
});
export type ProposalSnapshot = z.infer<typeof proposalSnapshotSchema>;
```

Note the multi-item tools store one draft per item (`items[].payload` is a single `EpicDraft` /
`StoryDraft`): the tool call's array payload is split into items at record time, so per-item
resolution needs no sub-indexing.

### `tools.ts` (tool table + handlers)

```ts
interface ToolDefinition {
	description: string;
	// SDK 1.x takes a zod raw shape (spike-verified with zod 4).
	inputShape(kind: SessionKind): z.ZodRawShape;
	handle(binding: SpawnBinding, args: unknown): Promise<CallToolResult>;
}
export const TOOL_TABLE: Record<BoardToolName, ToolDefinition>;
```

- `inputShape` is `.shape` of the payload schema; `propose_stories` returns the shape/define
  variant by `kind`.
- Every `handle` re-parses `args` with the full payload schema (`safeParse`; the SDK already
  validated, this is the trusted-type boundary), runs call-time semantic checks, then records via
  the proposals service and returns a text result.
- Call-time semantic checks (return `isError: true` text on failure, nothing recorded):
  - all tools: `binding.sessionId` set (unreachable in practice: tool calls follow `system/init`).
  - `propose_stories` (shape): payload `epic` slug resolves to exactly one live epic.
  - `propose_stories` (define) / `update_brief` / `resolve_question`: `binding.attach` present with
    the right type (spawn wiring guarantees it; check anyway, cheap).
  - `resolve_question`: the bound story currently has an unchecked Open questions item exactly
    matching `question` (via `boardSnapshot()`), so the model gets immediate feedback on a typo.
- Success result texts (the model-facing contract):
  - proposal tools: `Recorded proposal <id> with <n> item(s). The user will accept, edit, or
    reject each item; continue, or end your turn and await the outcome.`
  - `raise_decision` / `flag_risk`: `Recorded. The user will resolve it; continue or end your turn.`
  - `ask_user`: `Question recorded. End your turn now; the user's answer arrives as the next
    message.`
- Tool descriptions (registered with the SDK, model-facing):
  - `propose_epics`: "Propose one or more epics (optionally with draft stories). Each epic renders
    as a card the user accepts, edits, or rejects; accepting writes it to the board."
  - `propose_stories`: "Propose stories{ for the epic named by slug | for this epic}. Each story
    renders as a card the user resolves individually."
  - `update_brief`: "Propose replacing one section of this story's brief."
  - `resolve_question`: "Propose resolving one of this story's open questions with an answer."
  - `raise_decision`: "Raise a feature-level decision that must be settled before breakdown, tagged
    by who can settle it."
  - `flag_risk`: "Raise a blocking flaw in the brief: name where an implementer would stumble."
  - `ask_user`: "Ask the user one question, with your recommended answer and optional quick-reply
    options. End your turn after calling."

### `server.ts` (per-request construction)

```ts
export function buildMcpServer(binding: SpawnBinding): McpServer {
	const mcp = new McpServer({ name: MCP_SERVER_NAME, version: "0.0.0" });
	for (const name of KIND_REGISTRY[binding.kind].boardTools ?? []) {
		const def = TOOL_TABLE[name];
		mcp.registerTool(
			name,
			{ description: def.description, inputSchema: def.inputShape(binding.kind) },
			(args) => def.handle(binding, args),
		);
	}
	return mcp;
}
```

## Part E: services

### `src/server/services/mcp.ts`

```ts
import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";

export default defineService({
	name: "mcp",
	start: (ctx) => {
		setMcpPort(ctx.http.port);
		const app = new Hono();
		app.all("/mcp/:token", async (c) => {
			const binding = lookupSpawn(c.req.param("token"));
			if (binding === undefined) return c.text("unknown MCP token", 404);
			const transport = new StreamableHTTPTransport();
			await buildMcpServer(binding).connect(transport);
			return transport.handleRequest(c);
		});
		ctx.http.mount("/mcp", (request) => app.fetch(request));
	},
});
```

Fresh `McpServer` + transport per request (stateless, one transport per server instance), matching
the spike; the closure over `binding` is what binds every tool call server-side to its session and
card.

### `src/server/services/proposals.ts`

State (module singletons, in-memory only; a pending proposal dies with the process, per Out of
scope):

```ts
const proposals = new Map<string, Proposal>();
const questions = new Map<string, Question>();
const heldResumes = new Map<string, string[]>(); // sessionId -> resume messages awaiting `closed`
let handle: ChannelHandle<(typeof proposalChannel)["server"]> | undefined;
```

Recording (called from tool handlers; each broadcasts a fresh snapshot):

```ts
export function recordProposal(
	binding: SpawnBinding & { sessionId: string },
	tool: Exclude<BoardToolName, "ask_user">,
	items: unknown[],           // already schema-parsed payload drafts
	epic?: string,              // shape propose_stories target slug
): Proposal;
export function recordQuestion(
	binding: SpawnBinding & { sessionId: string },
	payload: AskUserPayload,
): Question;
```

Resolution (called from routes):

```ts
export async function resolveProposalItem(input: {
	proposalId: string;
	item: number;               // index into items
	resolution: ProposalResolution; // edit.payload validated against the tool's item schema here
}): Promise<void>;
export async function answerQuestion(input: { questionId: string; answer: string }): Promise<void>;
```

`resolveProposalItem` flow:

1. Look up proposal + item: unknown id/index → `NOT_FOUND`; `item.resolution` already set →
   `PROPOSAL_RESOLVED` (409).
2. Tool gate: `flag_risk` any outcome, `raise_decision` accept → `UNSUPPORTED_RESOLUTION` (501).
3. `edit`: parse `resolution.payload` with the tool's item schema (`epicDraftSchema`,
   `storyDraftSchema`, …); failure → `BAD_REQUEST` with the prettified zod error. The parsed
   payload replaces the item's payload.
4. `accept`/`edit`: perform the board write (below) inside `enqueueWrite`; a throw propagates to
   the RPC and leaves the item unresolved.
5. Mark the item resolved, broadcast a snapshot.
6. If every item is resolved: delete the proposal (broadcast again); if any item was edited or
   rejected, compose `proposalOutcomePrompt` and dispatch it (below).

Board writes per tool (all inside the queue task, minting included):

- `propose_epics` item: `nextEpicOrdinal` → `createEpic` (epic dir + `epic.md` + one story file per
  draft story, ordinals `01…N` in payload order, `depends` resolved among the same item's drafts;
  unresolvable → `BAD_REQUEST`).
- `propose_stories` item: resolve the target epic (bound card for define, payload slug for shape;
  vanished/ambiguous → `NOT_FOUND`/`BAD_REQUEST`) → `nextStoryOrdinal` → `createStory`; `depends`
  resolved against earlier-accepted items of this proposal (tracked as `slug → minted id` on the
  in-memory proposal) then existing stories in the epic; unresolvable → `BAD_REQUEST`.
- `update_brief` item: fresh `readStoryFile` of the bound story (ENOENT → `NOT_FOUND`, invalid →
  `INVALID_FILE`, mirroring `story.move`) → `replaceBriefSection` → `writeStory`.
- `resolve_question` item: fresh read → `checkQuestion`; no matching unchecked item →
  `NOT_FOUND` → `writeStory`.

`answerQuestion` flow: unknown id → `NOT_FOUND`; delete + broadcast; dispatch
`questionAnswerPrompt(question, answer)`.

Resume dispatch:

```ts
async function dispatchResume(sessionId: string, message: string): Promise<void> {
	if (isSessionLive(sessionId)) {
		heldResumes.set(sessionId, [...(heldResumes.get(sessionId) ?? []), message]);
		return;
	}
	await messageSession({ sessionId, prompt: message }); // SESSION_COLD/SESSION_STALE propagate to the RPC
}
```

Service `start`: register the `proposal` channel (`onSubscribe` sends the current snapshot),
subscribe `onSessionClosed` (new hook, below) to flush `heldResumes` for that session (join the
messages with a blank line, one `messageSession` call; log failures and drop, the session channel's
`closed` frame already told the client the turn ended). Stop handler clears all three maps.

### `src/server/services/sessions.ts` changes

- `export type Attach = …` (currently private).
- `runTurn` additions:

```ts
const mcpToken = randomUUID();
registerSpawn(mcpToken, { kind, attach });
const child = spawnSessionProcess({ …, mcpUrl: mcpEndpointUrl(mcpToken) });
// in onEvent, alongside the existing sessionId capture:
if (event.session_id !== undefined) bindSessionId(mcpToken, event.session_id);
// in the done handler:
releaseSpawn(mcpToken);
```

- New close hook and liveness probe for the proposals service:

```ts
const closedListeners = new Set<(info: { sessionId?: string; stale: boolean }) => void>();
export function onSessionClosed(listener: …): void;
export function isSessionLive(sessionId: string): boolean; // live.has(sessionId)
```

`runTurn`'s existing `done.then` invokes the listeners after updating `live`/`interrupted`.

## Part F: board module additions

### `src/board/ordinals.ts`

```ts
import { execFile } from "node:child_process"; // promisified

// Highest epic ordinal ever used: live dirs under .helm/board/epics plus every
// path git ever recorded as added there. --no-renames keeps a renamed dir
// counted as an add; --format= suppresses commit headers.
export async function nextEpicOrdinal(repoPath: string): Promise<number>;
export async function nextStoryOrdinal(repoPath: string, epicId: string): Promise<number>;
```

- Git invocation: `git -C <repoPath> log --diff-filter=A --no-renames --name-only --format= -- .helm/board/epics`.
  Parse lines with `/^\.helm\/board\/epics\/(\d{3})-/` (epics) and
  `/^\.helm\/board\/epics\/(\d{3})-[^/]+\/(\d{2})-[^/]+\.md$/` filtered to `epicId` (stories; the
  epic is matched by ordinal, not slug, so a renamed epic dir still retires its stories'
  ordinals). Empty output (fresh repo, nothing committed) is fine.
- Live side: `readdir` + `EPIC_DIR_RE` / `STORY_FILE_RE` (ENOENT → empty).
- Return `max + 1` (so `1` on a virgin board). Callers format with `padStart(3|2, "0")`; three
  digits cap at 999 epics / 99 stories, throw a plain error past that.

### `src/board/create.ts`

```ts
export interface StorySeed { slug: string; title: string; goal: string; depends: string[] } // resolved ids
export interface EpicSeed { slug: string; title: string; goal: string; rationale?: string }

// Writes <NNN>-<slug>/epic.md; returns the epic id and directory path.
export async function createEpic(
	repoPath: string,
	ordinal: number,
	seed: EpicSeed,
): Promise<{ epicId: string; dir: string }>;

// Writes <NN>-<slug>.md with frontmatter { id, status: "backlog", depends }.
export async function createStory(
	epicDir: string,
	epicId: string,
	ordinal: number,
	seed: StorySeed,
): Promise<{ storyId: string; path: string }>;
```

Both use the existing serializers (`serializeEpic`/`serializeStory` via `writeEpic`/`writeStory`)
with the body builders below; `createEpic` runs `mkdir` (non-recursive; an unexpectedly existing
dir throws, the minting guarantees a fresh ordinal).

### `src/board/markdown.ts` additions

```ts
// All six template headings in BRIEF_SECTIONS order, Goal filled, the rest empty.
export function buildStoryBody(title: string, goal: string): string;
// "# <title>", the goal paragraph, then the rationale paragraph when present.
export function buildEpicBody(title: string, goal: string, rationale?: string): string;
// Replace the "## <section>" block (up to the next #/## heading or EOF); a
// missing heading is inserted at its BRIEF_SECTIONS position relative to the
// template headings present.
export function replaceBriefSection(body: string, section: BriefSection, content: string): string;
// Set "- [ ] <question>" to "- [x] <question>" inside Open questions; undefined
// when no unchecked item matches exactly.
export function checkQuestion(body: string, question: string): string | undefined;
```

## Part G: shared channel

`src/shared/channels.ts`:

```ts
import { proposalSnapshotSchema } from "../server/mcp/schemas.ts"; // pure zod, browser-safe

// Pending proposals and questions: full snapshot on (re)subscribe and on every
// change, like the board channel. Resolutions go over RPC.
export const proposalChannel = defineChannel("proposal", {
	server: { snapshot: proposalSnapshotSchema },
	client: {},
});
```

## Part H: routes (`src/worker/routes/proposal.ts`)

```ts
export const proposal = {
	// Per-item resolution; the proposal channel's snapshot is the authority, so
	// nothing is returned. Board writes serialize through the write queue; a
	// fully resolved proposal with edits/rejections resumes the session (held
	// until its turn ends if it is mid-turn).
	resolve: procedure()
		.input(z.object({
			proposalId: z.uuid(),
			item: z.number().int().nonnegative(),
			resolution: proposalResolutionSchema,
		}))
		.handler(({ input }) => resolveProposalItem(input)),
	// Answers a pending ask_user question and resumes the session with it.
	answer: procedure()
		.input(z.object({ questionId: z.uuid(), answer: z.string().min(1) }))
		.handler(({ input }) => answerQuestion(input)),
};
```

Run `pnpm generate` to regenerate `src/worker/routes/index.ts` and the services barrel
(`src/server/services/index.ts`) after adding the new files.

## Part I: knowledge-base updates

- `.knowledge/architecture/api.md`: add `proposal.resolve` and `proposal.answer` to the procedures
  table; document the `proposal` WS channel (snapshot semantics) next to `board`/`session`; add
  error rows:

| Code                     | Meaning                                                          | `data` |
| ------------------------ | ---------------------------------------------------------------- | ------ |
| `PROPOSAL_RESOLVED`      | The item is already resolved / the question already answered (HTTP 409). | none |
| `UNSUPPORTED_RESOLUTION` | The tool's accept path lands with a later stage (`raise_decision` 001-04, `flag_risk` 001-06) (HTTP 501). | none |

- `.knowledge/architecture/claude-integration.md` §Board tools: one sentence that caller identity
  rides the per-spawn endpoint (`/mcp/<token>`), so payloads never carry ids.
- `.knowledge/architecture/board-storage.md` §Layout: one sentence that minting scans the live
  tree plus git's added-path history, which is what retires ordinals permanently.

## Edge cases (behavior settled here)

- Unknown `/mcp/<token>` → 404; the CLI reports the server as failed in `system/init`.
- Payload fails SDK schema validation → the SDK returns `isError: true` without running the
  handler; nothing recorded (acceptance criterion 6). Semantic failures inside the handler return
  `isError: true` with a corrective message.
- Resolving an item twice (double-click, two clients) → second call gets `PROPOSAL_RESOLVED`.
- Accept whose board write throws → RPC surfaces the error, item stays pending, retry works.
- Reject/edit finishing a proposal while the session is still streaming → resume held, flushed on
  `closed`; multiple held messages join into one resume.
- Answering a cold kind's `ask_user` (`research`, `adversary`) → `SESSION_COLD` from
  `messageSession`, surfaced to the client; reworked in 001-06.
- Session reseeded between record and resume → `messageSession` already reseeds from the card; the
  resume message rides the fresh session.
- Orchestrator restart → pending proposals and questions vanish (stated out of scope); the chat
  resumes and re-proposes.
- Epic slug duplicated across epics: legal on disk; only shape's `propose_stories` needs
  slug → epic resolution and errors on ambiguity.
- `.helm/board/epics` with no git history (nothing committed yet) → minting falls back to the live
  tree alone; a repo where `git log` itself fails throws.
- Two accepts racing → both queue tasks run serially; each mints inside its task, so ordinals never
  collide.
- Watcher pickup: `createEpic`/`createStory` write into the watched tree; `addDir` + `add` events
  rebuild the snapshot (acceptance criterion 3 needs no extra wiring).

## Implementation order

1. Stack: `ServiceHttp` + dispatcher + tests + `runtime.md` (in `../stack`; `pnpm check`,
   `pnpm test`).
2. Helm deps (`@hono/mcp`, `@modelcontextprotocol/sdk`, `hono`), `pnpm install`.
3. `src/sessions/kinds.ts` (board tool names, prompts), `src/sessions/runner.ts` (`mcpUrl`),
   `src/sessions/prompts.ts` (resume builders).
4. `src/server/mcp/schemas.ts`, `src/shared/channels.ts`.
5. `src/board/ordinals.ts`, `src/board/create.ts`, `markdown.ts` builders.
6. `src/server/mcp/registry.ts`; `src/server/services/sessions.ts` wiring (`Attach` export, token
   lifecycle, `onSessionClosed`, `isSessionLive`).
7. `src/server/services/proposals.ts`, `src/server/mcp/tools.ts`, `src/server/mcp/server.ts`,
   `src/server/services/mcp.ts`.
8. `src/worker/routes/proposal.ts`, `pnpm generate`.
9. Knowledge-base updates (Part I).
10. `pnpm check`; verification below.

## Verification (no test suite in Helm; drive the real thing)

Setup: scratch target repo (`git init`, empty `.helm/board/epics/`), `helm.config.json` pointing at
it, `stack dev` (node server on 8788). Drive RPC with `curl` against `/rpc` and watch WS with a
scratch `ws` script (subscribe to `board`, `session`, `proposal`).

Per acceptance criterion:

1. `session.spawn { kind: "shape", prompt: … }`; assert the `system/init` event shows
   `mcp_servers: [{ name: "helm", status: "connected" }]` only, and `tools` contains exactly the
   kind's `mcp__helm__*` names.
2. Spawn with a prompt that forces one `propose_epics` call; assert a `proposal` snapshot arrives
   with the pending proposal and `git -C <repo> status --porcelain` shows nothing under
   `.helm/board/`.
3. `proposal.resolve { …, resolution: { type: "accept" } }`; assert the epic dir + `epic.md`
   exist, and a `board` snapshot containing the epic arrives via the watcher without restart.
4. Repeat with `{ type: "reject", reason: … }`; assert the session resumes (new `system/init` on
   the session channel with the same session id) and the next assistant text addresses the reason.
5. Force an `ask_user` call; assert the question appears in the `proposal` snapshot and the
   process exits (`closed` frame, `result` success); `proposal.answer`; assert the resumed turn
   uses the answer.
6. `curl` the live `/mcp/<token>` endpoint directly with a JSON-RPC `tools/call` carrying an
   invalid payload (e.g. `propose_epics` with `epics: []`); assert an `isError` result and no
   `proposal` snapshot change. (Deterministic, unlike prompting the model into invalid input.)

Also verify: a `define` spawn without `epicId` still fails `BAD_REQUEST` (unchanged); stack tests
green; `pnpm check` green in both repos.
