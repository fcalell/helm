# Claude CLI integration

Every Helm conversation and run is a real Claude Code session driven through the headless CLI.
Facts below were verified against the official docs (code.claude.com) at project founding;
**re-verify flags and auth behavior against current docs before building on them**: the CLI moves
fast.

## Why the CLI, not the Agent SDK

The Agent SDK (`@anthropic-ai/claude-agent-sdk`) requires `ANTHROPIC_API_KEY`; Anthropic's docs
prohibit third-party products from offering claude.ai login or subscription rate limits. Headless
`claude -p` inherits whatever auth the local CLI has, including a Max subscription login. Helm
therefore shells out to the user's own logged-in CLI and stays instance-per-user; wrapping the
local CLI in a UI has no documented ToS restriction. Distributing Helm is fine as long as each
user brings their own authenticated CLI; brokering their claude.ai auth is not.

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

## Board tools (in-process MCP)

Chat sessions receive an MCP server hosted by the orchestrator, passed via `--mcp-config`:
`propose_stories`, `update_brief`, `resolve_question`. Tool calls become UI proposal widgets;
**accepting a widget is what writes the board file**, the tool call itself mutates nothing. This is
how structure is extracted from conversation without parsing prose
([define-refine](../product/features/define-refine.md) §Proposal widgets).

## Hooks

Run sessions carry hook config (via `--settings`) so lifecycle events write story frontmatter: the
Stop hook records the run outcome and flips status (Running → Review), keeping the board truthful
even if the orchestrator missed the stream. The orchestrator's file watcher picks the change up
like any other edit.

## Auth on a headless host

`claude setup-token` (run once on a machine with a browser) mints a long-lived OAuth token tied to
the Max subscription; the orchestrator's environment carries it as `CLAUDE_CODE_OAUTH_TOKEN`.
Precedence gotcha: any `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the environment outranks
the OAuth token; keep the orchestrator's env clean of them.

## Rate limits

Subscription limits (5-hour rolling window + weekly caps) apply identically to headless and
interactive use, one shared pool. The orchestrator meters usage per run (token counts from result
events) to drive the queue's auto-pause ([runs](../product/features/runs.md) §Queue).
