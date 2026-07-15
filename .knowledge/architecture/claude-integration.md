# Claude CLI integration

Every Helm conversation and run is a real Claude Code session driven through the headless CLI.
Facts below were verified against the official docs (code.claude.com) at project founding;
**re-verify flags and auth behavior against current docs before building on them**: the CLI moves
fast.

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

- `--output-format stream-json`: newline-delimited JSON events (assistant text, tool calls,
  results) the orchestrator parses and forwards over WS.
- `--resume <session-id>`: every user message resumes the card's session; session IDs live in
  story frontmatter ([board-storage](./board-storage.md)). Sessions survive orchestrator restarts
  and machine reboots.
- `--permission-mode` + `--allowedTools`: implement the per-story permission presets
  ([runs](../product/features/runs.md)); define/refine chats get the read-only allowlist
  (Read/Grep/Glob + board tools).
- `--append-system-prompt`: injects the brief template / run contract per session kind.
- Working directory: the target repo (chats) or the story's worktree (runs).

Transcripts live at `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`; JSONL format is internal
and version-unstable, so Helm treats transcripts as Claude Code's property and keeps its own state
in `.helm/` frontmatter. Session lookup is scoped to the working directory (worktrees included),
so resume must run from the same cwd that created the session.

Two more resume limits shape design. Claude Code deletes idle transcripts after `cleanupPeriodDays`
(default 30), so a session parked for weeks stops resuming: the server raises the setting, and a
resume that fails anyway starts a fresh session seeded from the card. And a running `-p` process
accepts no further input: steering a live run means killing the process and resuming the session
with the steering message. Whether the Stop hook fires on that kill is undocumented; the spike
answers it ([roadmap](../product/roadmap.md) §Next steps).

## Board tools (in-process MCP)

Chat sessions receive an MCP server hosted by the orchestrator (official MCP SDK, streamable HTTP
on localhost, mounted on the orchestrator's own Hono app), passed via `--mcp-config`:
`propose_stories`, `update_brief`, `resolve_question`. Tool calls become UI proposal widgets;
**accepting a widget is what writes the board file**, the tool call itself mutates nothing. This is
how structure is extracted from conversation without parsing prose
([define-refine](../product/features/define-refine.md) §Proposal widgets).

Run sessions get their own pair. `ask_user` records a mid-run question and tells the agent to end
its turn; the answer resumes the session, and a pending question is what distinguishes a stuck run
from a finished one when the process exits ([runs](../product/features/runs.md) §Needs input).
`update_card` applies body edits (checking off criteria, noting decisions), so the agent never
writes `.helm/` files itself ([board-storage](./board-storage.md) §Mutation rules).

## Permission prompts

Runs pass `--permission-prompt-tool` naming a tool on the same orchestrator MCP server. When a
Guarded-preset run needs approval, the CLI calls that tool; the orchestrator holds the request,
pushes a WS event (approve/deny buttons on the card, plus a notification), and the tool's return
value allows or denies. No hook polling, no terminal prompt. The held call is bounded by
`MCP_TOOL_TIMEOUT`: the orchestrator raises it, and the spike measures how long a prompt can
realistically block. If hours-long holds prove untenable, the fallback is deny-with-reason plus a
Needs-input resume.

## Hooks

Run sessions carry hook config (via `--settings`) as a backstop: the Stop hook POSTs the run
outcome to the orchestrator's HTTP API, and writes the main checkout's frontmatter directly only
when the orchestrator is unreachable. That keeps the board truthful if the orchestrator missed the
stream, while preserving its single-writer rule ([board-storage](./board-storage.md) §Mutation
rules). Hooks may not fire at all on a killed process; startup reconciliation
([overview](./overview.md) §Shape) is the safety net for missed events.

## Auth on a headless host

`claude setup-token` (run once on a machine with a browser) mints a long-lived OAuth token tied to
the Max subscription; the orchestrator's environment carries it as `CLAUDE_CODE_OAUTH_TOKEN`.
Precedence gotcha: any `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the environment outranks
the OAuth token; keep the orchestrator's env clean of them.

## Rate limits

Subscription limits (5-hour rolling window + weekly caps) apply identically to headless and
interactive use, one shared pool. No API reports remaining headroom, and interactive use on other
machines is invisible to Helm, so the meter (token counts from result events, summed across every
session kind: chats, runs, grading, conflict resolution) is a lower-bound estimate. Limit errors
are the authoritative signal: the queue pauses on one and resumes when the window rolls
([runs](../product/features/runs.md) §Queue & rate limits).
