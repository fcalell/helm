# Claude CLI integration

Every Helm conversation and run is a real Claude Code session driven through the headless CLI.
Facts below were verified against the official docs (code.claude.com) at project founding; the ones
marked spike-verified were measured against CLI 2.1.210 by the stream-json spike
(`spikes/stream-json/`). **Re-verify flags and auth behavior against current docs before building
on them**: the CLI moves fast.

## Why the CLI, not the Agent SDK

The Agent SDK (`@anthropic-ai/claude-agent-sdk`) requires `ANTHROPIC_API_KEY`; Anthropic's docs
prohibit third-party products from offering claude.ai login or subscription rate limits. Headless
`claude -p` inherits whatever auth the local CLI has, including a Max subscription login. Helm
therefore shells out to the user's own logged-in CLI and stays instance-per-user. The legal page
(code.claude.com/docs/en/legal-and-compliance) draws the line explicitly: running Claude Code on
your own machine is exempt from the Consumer ToS prohibition on automated access, but third-party
orchestrators routing Max credentials on behalf of users are not permitted. Personal Helm sits on
the allowed side; a public release ships API-key auth as its distribution mode and re-checks that
page first ([vision](../product/vision.md) §Ambition).

## Invocation model

One `claude -p` process per chat turn or run segment:

- `--output-format stream-json` (requires `--verbose` under `-p`): newline-delimited JSON events
  the orchestrator parses and forwards over WS. Spike-verified stream: `system/init` (session id,
  tools, MCP server statuses, model, permission mode, `apiKeySource: "none"` on subscription),
  `assistant`/`user` (full API messages with usage), `rate_limit_event` (§Rate limits), `result`
  (subtype `success` or `error_during_execution`, result text, usage, `permission_denials`).
- `--resume <session-id>`: every user message resumes the card's session; the id stays stable
  across resumes (spike-verified), so frontmatter stores one id per session kind
  ([board-storage](./board-storage.md)). Sessions survive orchestrator restarts and machine
  reboots.
- `--strict-mcp-config`: without it every headless run loads the user's global MCP servers
  (spike-verified); skills and settings load regardless, so runs are not hermetic. The target
  repo's root `CLAUDE.md` auto-loads and, through its `@.helm/agents/index.md` import, pulls in Helm's
  rules (plus user-global `~/.claude`), so a managed repo's standing rules already shape every Helm
  run; curating them is a planned feature ([roadmap](../product/roadmap.md) §Later, Rules & knowledge
  library).
- `--permission-mode` + `--allowedTools`: implement the per-story permission presets
  ([runs](../product/features/runs.md)); define/refine chats get the read-only allowlist
  (Read/Grep/Glob + board tools).
- `--append-system-prompt`: injects the brief template / run contract per session kind.
- `--model`: the per-kind model, so read-only chats stay cheap and implementation runs on the
  frontier model ([session-kinds](./session-kinds.md)).
- Working directory: the target repo (chats) or the story's worktree (runs).

Transcripts live at `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`; JSONL format is internal
and version-unstable, so Helm treats transcripts as Claude Code's property and keeps its own state
in `.helm/` frontmatter. Session lookup is scoped to the working directory (worktrees included),
so resume must run from the same cwd that created the session.

Two more resume limits shape design. Claude Code deletes idle transcripts after `cleanupPeriodDays`
(default 30), so a session parked for weeks stops resuming: the server raises the setting, and a
resume that fails anyway starts a fresh session seeded from the card. The failure is loud
(spike-verified): exit 1, stderr `No conversation found with session ID`, one
`result/error_during_execution` event. Session lookup is keyed to the cwd path, not the directory
itself; a deleted-and-recreated worktree path still resumes (spike-verified). And a running `-p`
process accepts no further input: steering a live run means killing the process and resuming the
session with the steering message. Spike-verified: a SIGTERM mid-tool-call resumes cleanly with
full memory, but the resumed model believes the interrupted tool call never ran even though its
side effects may have partially landed, so the steering message states the interruption.

## Context management

Model and context are set per session kind ([session-kinds](./session-kinds.md)). Two mechanics
live at the CLI boundary. Chats reseed: a resume that fails because the transcript was cleaned up
starts a fresh session seeded from the card (§Invocation model). Runs compact: a headless process
has no interactive `/compact`, so the orchestrator watches window usage from the `assistant` and
`result` event totals and, near the limit, ends the turn and writes a **handoff**: the run squeezed
to its resumable core (what is in flight and why, and what is left to do), referencing the brief,
the diff, and settled decisions by path instead of restating them, with secrets redacted. The run
resumes from that handoff plus the brief reloaded from its spawn snapshot (a mid-run hand edit
never rewrites the contract, [runs](../product/features/runs.md)), and is told its earlier tool
output was summarized, the same caution a steering resume carries (§Invocation model). Compaction is
designed, not yet spike-verified: re-verify the CLI's headless context behavior before building it.

## Board tools (in-process MCP)

Chat sessions receive an MCP server hosted by the orchestrator (official MCP SDK, streamable HTTP
on localhost, mounted on the orchestrator's own Hono app), passed via `--mcp-config`. The tools
vary by session kind ([session-kinds](./session-kinds.md)): `shape` proposes epics
(`propose_epics`) and stories (`propose_stories`) and raises feature-level decisions
(`raise_decision`), `define` proposes stories, `refine` builds the
brief (`update_brief`, `resolve_question`), `adversary` raises blocking flaws (`flag_risk`), and
`init` proposes repo scaffolding (`propose_scaffold`).
Tool calls become UI proposal widgets; **accepting a widget is what writes the board file**, the
tool call itself mutates nothing. This is how structure is extracted from conversation without
parsing prose ([define-refine](../product/features/define-refine.md) §Proposal widgets).

Run sessions get `update_card`, which applies body edits (noting decisions and progress; criteria
checkboxes belong to review, [review](../product/features/review.md) §Self-grading) so the agent
never writes `.helm/` files itself ([board-storage](./board-storage.md) §Mutation rules).

`ask_user` is available to every session kind, not runs alone. It records a question and tells the
agent to end its turn; the answer resumes the session, and a pending question is what distinguishes
a stuck session from a finished one when the process exits ([runs](../product/features/runs.md)
§Needs input). A run that calls it flips the card to Needs input; a chat kind renders the question
inline in the drawer.

## Permission prompts

Runs pass `--permission-prompt-tool` naming a tool on the same orchestrator MCP server. When a
Guarded-preset run needs approval, the CLI calls that tool; the orchestrator holds the request,
pushes a WS event (approve/deny buttons on the card, plus a notification), and the tool's return
value allows or denies. No hook polling, no terminal prompt. Spike-verified contract: the CLI
calls the tool with `{tool_name, input, tool_use_id}`; text content
`{"behavior":"allow","updatedInput":<input>}` releases the call, `{"behavior":"deny","message"}`
blocks it. Read-only commands (`git log`, `ls`) never consult the tool; only mutating calls ask. A
held approval survived 4 minutes on default env; the orchestrator still raises `MCP_TOOL_TIMEOUT`
for longer waits, and if hour-long holds prove untenable the fallback is deny-with-reason plus a
Needs-input resume.

## Hooks

Run sessions carry hook config (via `--settings`) as a backstop: the Stop hook POSTs the run
outcome to the orchestrator's HTTP API, and writes the main checkout's frontmatter directly only
when the orchestrator is unreachable. That keeps the board truthful if the orchestrator missed the
stream, while preserving its single-writer rule ([board-storage](./board-storage.md) §Mutation
rules). The Stop hook fires on normal completion and does not fire on SIGTERM (spike-verified:
exit 143, no `result` event); startup reconciliation ([overview](./overview.md) §Shape) is the
safety net for killed processes.

## Auth on a headless host

`claude setup-token` (run once on a machine with a browser) mints a long-lived OAuth token tied to
the Max subscription; the orchestrator's environment carries it as `CLAUDE_CODE_OAUTH_TOKEN`.
Precedence gotcha: any `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the environment outranks
the OAuth token; keep the orchestrator's env clean of them.

## Rate limits

Subscription limits (5-hour rolling window + weekly caps) apply identically to headless and
interactive use, one shared pool. Every spawned session emits a `rate_limit_event`
(spike-verified) carrying `status`, `resetsAt`, and the window type (`five_hour`), so the meter
gets the window's reset clock and an allowed/limited signal for free on each spawn. Numeric
headroom stays unreported, and interactive use on other machines is invisible to Helm, so the
token side of the meter (counts from result events, summed across every session kind: chats, runs,
grading, conflict resolution) is a lower-bound estimate. Limit errors are the authoritative
signal: the queue pauses on one and resumes when the window rolls
([runs](../product/features/runs.md) §Queue & rate limits).
