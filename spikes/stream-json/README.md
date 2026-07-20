# Stream-json spike

Throwaway scripts that answered the roadmap's riskiest assumptions against `claude` CLI 2.1.210 on
Max-subscription auth (July 2026). Run any script with `node <name>.ts` after `pnpm install`; each
creates `toy-repo/` on first use. Durable conclusions live in
[claude-integration](../../.knowledge/architecture/claude-integration.md); this file records the raw
observations behind them.

## Scripts

- `lib.ts`: spawn + NDJSON parse helper, toy-repo setup.
- `01-spawn-resume.ts`: spawn, resume with an answer, resume again with feedback.
- `02-mcp-board-tool.ts`: streamable-HTTP MCP server in-process, one board-tool call.
- `03-permission-prompt.ts`: `--permission-prompt-tool` round-trip with a held approval.
  Args: `node 03-permission-prompt.ts [holdMs] [once]`.
- `04-lifecycle.ts`: Stop hook on normal end and on SIGTERM, kill-then-resume, resume after
  transcript deletion, resume from a deleted-and-recreated cwd.

## Observations

- **Auth**: headless `-p` on subscription login works; `system/init` reports
  `apiKeySource: "none"`. `result` events still carry `total_cost_usd` and per-model `modelUsage`
  (informational under subscription).
- **Event stream** (`--output-format stream-json` requires `--verbose`): `system/init` (session id,
  tools, MCP servers with status, model, permission mode), `system/thinking_tokens`,
  `rate_limit_event`, `assistant` / `user` (full API messages, tool results, usage),
  `result` (subtype `success` or `error_during_execution`, result text, usage, `num_turns`,
  `permission_denials`).
- **Every run emits a `rate_limit_event`** whose payload nests under a `rate_limit_info` object
  (measured on 2.1.215): `status` (`allowed`), `resetsAt` (unix seconds), `rateLimitType`
  (`five_hour`), and overage status. No numeric headroom, but the reset clock and status come free
  on each spawn.
- **`--resume` keeps the session id stable** across any number of resumes; context carries over.
- **Global config leaks into headless runs**: the user's MCP servers, skills, and slash commands all
  loaded at init. `--strict-mcp-config` removes the MCP servers; skills and settings still load.
- **Streamable-HTTP MCP under `-p` works.** SDK v1 stateless pattern: one fresh
  `McpServer` + transport per request (an instance allows a single transport). Tool call arrived
  in-process; init showed `{"name":"helm","status":"connected"}`.
- **Permission prompt contract**: the CLI calls the named MCP tool with
  `{tool_name, input, tool_use_id}`; replying with text content
  `{"behavior":"allow","updatedInput":<input>}` releases the call. Read-only commands (`git log`)
  never consult the tool; they pass the CLI's safe-command allowlist. A held approval survived
  75 s and 240 s on default env (no `MCP_TOOL_TIMEOUT` needed at that scale), and 75 s with
  `MCP_TOOL_TIMEOUT=600000`.
- **Stop hook fires on normal completion, and does not fire on SIGTERM.** The killed process exits
  143 with no `result` event.
- **Kill mid-tool-call is safe to resume**: same session id, full memory, but the resumed model
  believes the interrupted command never ran even though its side effects may have partially
  landed. A steering resume must state the interruption.
- **Deleted transcript fails loud**: exit 1, stderr `No conversation found with session ID: …`, a
  single `result/error_during_execution` event. Detecting a dead session to reseed from the card is
  trivial.
- **Deleted-and-recreated cwd resumes fine**: transcripts are keyed to the cwd path slug
  (`~/.claude/projects/<cwd-slug>/`), not the directory inode.
