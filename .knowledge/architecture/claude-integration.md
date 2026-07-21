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
  reboots. A resume that changes `--model` or `--effort` forfeits the warm prompt cache: the
  request shape keys the cache, so the full transcript re-enters as fresh cache writes on the
  next turn (measured on 001-03's fix-up, which re-wrote its 208k-token transcript). Tier
  switches on resume therefore carry a fixed cost proportional to transcript length, priced into
  the follow-up routing ([session-kinds](./session-kinds.md) §Model per kind).
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
- `--effort <level>`: the per-kind reasoning effort (`low` · `medium` · `high` · `xhigh` ·
  `max`), verified against CLI 2.1.177. A valid level is accepted silently; an unknown value
  warns on stderr and falls back to the default. Effort is not echoed in `system/init`.
- `--include-partial-messages`: adds `stream_event` events wrapping the raw API stream
  (`message_start`, `content_block_delta` with text/thinking deltas, `message_stop`, …), so a UI
  renders assistant output incrementally (verified 2.1.177).
- `--permission-mode`: passed explicitly on every spawn. The mode otherwise comes from the user's
  own config, and a laxer setting there (`auto`) would execute tools outside the kind's
  allowlist.
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

Two headless behaviors shape every prompt Helm writes for a `-p` session (both measured across
the 002 loop emulations). Ending the turn terminates the process and everything it left running,
so a session that ends its turn to "wait for" a background task dies with the task unfinished;
run prompts state it outright and demand foreground polling. And the `result` event's text is the
session's only output channel: a payload split between the transcript and the final message
strands the transcript half (one standards review returned a bare verdict with its findings stuck
in mid-stream narration, recovered only by a paid resume), so any prompt expecting a structured
deliverable demands the complete payload, findings and verdict together, in the final message.

## Verifying without burning the pool

Helm's own verification runs real spawn and UI cycles without spending subscription tokens; two
measured patterns cover nearly everything, with real spawns reserved for behavior only the live
CLI shows (compaction, refusals, rate-limit events):

- **Stub `claude` on `PATH`**: a script that logs its argv and replays recorded stream-json
  init/result frames. A live orchestrator pointed at it exercises full spawn/close/exit cycles,
  flag construction (`--model`/`--effort`/`--resume`), the close path, and queue behavior at zero
  pool cost (002-07 verified eleven of twelve criteria this way).
- **Headless Chromium via playwright-core** against a live orchestrator on a scratch target repo:
  DOM assertions plus intercepted RPC traffic verify UI behavior end to end (002-08 ran 26 checks
  this way), skipping only clicks that would spawn real sessions, which get by-hand steps in the
  run report instead.

Both lean on `helm.config.json` being gitignored machine config: a scratch config pointing at a
throwaway repo swaps in for the test and must never be committed.

## Context management

Model and context are set per session kind ([session-kinds](./session-kinds.md)). Chats reseed: a
resume that fails because the transcript was cleaned up starts a fresh session seeded from the card
(§Invocation model). Runs compact natively: headless `-p` auto-compacts mid-turn (measured on
2.1.215 against subscription auth: a probe turn under `CLAUDE_CODE_AUTO_COMPACT_WINDOW=45000`
compacted three times and finished `success` in one process, the session id stayed stable, and a
later `--resume` kept post-compact memory). Each compaction emits a `system` event, verbatim
(object fields trimmed):

```json
{"type":"system","subtype":"compact_boundary","session_id":"…","compact_metadata":{"trigger":"auto","pre_tokens":66160,"post_tokens":15035,"cumulative_dropped_tokens":51125,"duration_ms":26071,"preserved_segment":{…},"preserved_messages":{…}}}
```

The orchestrator hardens the native mechanism instead of driving its own:

- Every run segment's per-spawn settings file sets `autoCompactEnabled: true`. Settings precedence
  is `--settings` > project > user (measured: the same over-threshold task under
  `{"autoCompactEnabled": false}` emitted zero boundaries), so a user-global disable never starves
  a run. The CLI owns the trigger; no orchestrator watching, no threshold constant.
- The brief rides every segment's system prompt through `--append-system-prompt`, built from the
  spawn snapshot file, so the contract structurally survives summarization and a mid-run hand edit
  never rewrites it ([runs](../product/features/runs.md)). The
  flag rides resumes too, and a resumed session reads it (measured: a marker appended on resume was
  acknowledged); a byte-identical seed across segments keeps the prompt-cache prefix stable.
- The boundary event broadcasts like any other session event and lands on the run's activity
  timeline as a marker row.
- An overflow the CLI cannot compact past (docs: one oversized file or tool result; the API error
  is "Prompt is too long") surfaces as an error result, and the close path parks the card Blocked.

`CLAUDE_CODE_AUTO_COMPACT_WINDOW` shrinks the capacity auto-compact calculates against, so
compaction is testable end to end without filling a real window. Spawned children inherit it from
the orchestrator's environment; production hosts never set it.

## Board tools (in-process MCP)

Chat sessions receive an MCP server hosted by the orchestrator (official MCP SDK, streamable HTTP
on localhost, mounted on the orchestrator's own Hono app), passed via `--mcp-config`. The tools
vary by session kind ([session-kinds](./session-kinds.md)): `shape` proposes epics
(`propose_epics`) and stories (`propose_stories`) and raises feature-level decisions
(`raise_decision`), `define` proposes stories, `refine` builds the
brief (`update_brief`, `resolve_question`) and contests gate flags (`contest_flag`,
[define-refine](../product/features/define-refine.md) §Ready gate), `adversary` raises blocking
flaws (`flag_risk`), and
`init` proposes repo scaffolding (`propose_scaffold`).
Tool calls become UI proposal widgets; **accepting a widget is what writes the board file**, the
tool call itself mutates nothing. This is how structure is extracted from conversation without
parsing prose ([define-refine](../product/features/define-refine.md) §Proposal widgets). Caller
identity rides the transport, not the payload: each spawn gets its own endpoint (`/mcp/<token>`,
bound to its session and card once `system/init` reports the id), so tool payloads never carry
session, epic, or story ids.

Run sessions get `update_card`, which applies body edits (noting decisions and progress; criteria
checkboxes belong to review, [review](../product/features/review.md) §Self-grading) so the agent
never writes `.helm/` files itself ([board-storage](./board-storage.md) §Mutation rules).

`ask_user` is available to every session kind, not runs alone. It records a question and tells the
agent to end its turn; the answer resumes the session, and a pending question is what distinguishes
a stuck session from a finished one when the process exits ([runs](../product/features/runs.md)
§Needs input). A run that calls it flips the card to Needs input; a chat kind renders the question
inline in the drawer.

## Permission prompts

Guarded and Manual runs pass `--permission-prompt-tool mcp__helm__approve`, a tool on the same
orchestrator MCP server (registered for run bindings only; the CLI calls it, never the model).
When the run needs approval, the CLI calls the tool; the orchestrator holds the request, pushes it
on the proposal channel (approve/deny buttons on the card), and the tool's return value allows or
denies. No hook polling, no terminal prompt. Contract, measured end-to-end against the
orchestrator's real streamable-HTTP endpoint (`ctx.http.mount` on `@hono/node-server`, CLI
2.1.215): the CLI calls the tool with `{tool_name, input, tool_use_id}`; text content
`{"behavior":"allow","updatedInput":<input>}` releases exactly the recorded call (`git log` shows
the released commit), `{"behavior":"deny","message"}` blocks it and the message lands in the
session stream as the denial. Read-only commands never consult the tool, the CLI's own
classification: a non-allowlisted `git status` under an active prompt tool ran free while `touch`
and `git add`/`git commit` asked. The hold is two-ended: the CLI-side knob is `MCP_TOOL_TIMEOUT`
(run spawns set four hours; the default window is 5 minutes), and the server side has no observed
ceiling. A held approval survived 6m53s on the real adapter and released cleanly, past Node's
5-minute `requestTimeout` default, which bounds receiving the request, not a held response
(`server.timeout` defaults off; the stack's adapter sets no extra timeout), so no server-side
knob needed raising. If hour-long holds prove untenable the fallback is deny-with-reason plus a
Needs-input resume.

## Hooks

Run sessions carry hook config (via `--settings`) as a backstop: the Stop hook POSTs the run
outcome to the orchestrator's HTTP API, and writes the main checkout's frontmatter directly only
when the orchestrator is unreachable. That keeps the board truthful if the orchestrator missed the
stream, while preserving its single-writer rule ([board-storage](./board-storage.md) §Mutation
rules). The Stop hook fires on normal completion and does not fire on SIGTERM. On SIGTERM the CLI
flushes one `result/error_during_execution` frame carrying the segment's usage before exiting
(measured live on 2.1.215; earlier versions exited with no `result` event), so an observed error
result never proves the run ended on its own: only a clean result or the hook POST does, which is
what the run close path treats as a genuine finish when a deliberate kill (steer/pause/stop) is in
flight. Startup reconciliation ([overview](./overview.md) §Shape) is the safety net for killed
processes.

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
