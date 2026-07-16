# Session kinds

Every `claude` process Helm spawns belongs to one **session kind**, a closed set that fixes the
prompt, tool allowlist, model, and context policy for that stage of the loop. The kind is the one
place per-stage configuration lives, so "cheap model for read-only chat, frontier model for
implementation" and "compact a long run, reseed a stale chat" are table rows, not scattered flags.
Helm stays a single fixed workflow; the kinds are its stages, never user-authored steps
([vision](../product/vision.md) §Non-goals). The artifact a kind produces is stamped from a template
([templates](./templates.md)). The CLI mechanics each kind rides on are in
[claude-integration](./claude-integration.md).

## Registry

| Kind        | Stage                                   | Tools                                          | Model  | Context               |
| ----------- | --------------------------------------- | ---------------------------------------------- | ------ | --------------------- |
| `init`      | onboard a repo: propose scaffolding      | read-only + `propose_scaffold`                  | Sonnet | reseed on stale       |
| `shape`     | Shaping: roadmap/feature chat → epics    | read-only + `propose_epics` / `propose_stories` / `raise_decision` | Haiku | reseed on stale |
| `research`  | resolve a shaping decision by investigation | read-only                                    | Haiku  | always cold           |
| `define`    | epic → stories                           | read-only + `propose_stories`                   | Haiku  | reseed on stale       |
| `refine`    | story → brief                            | read-only + `update_brief` / `resolve_question` | Sonnet | reseed on stale       |
| `adversary` | ready gate: attack the brief             | read-only + `flag_risk`                         | Opus   | always cold           |
| `run`       | implement a Ready story                  | permission preset + `update_card`               | Opus   | compact under pressure |
| `review`    | grade + test a finished run              | read-only + test-command Bash                   | Sonnet | cold                  |
| `conflict`  | rebase conflict resolution               | worktree tools                                  | Sonnet | cold                  |

`ask_user` is available to every kind, not runs alone: it is the one primitive for a session to put
a question to the user and end its turn (§Interaction). Read-only means the CLI's Read/Grep/Glob
plus the kind's board tools, with no Edit or Bash except where a row adds it.

## Model per kind

Each kind names a model, passed as `--model`; the rate-limit pool is shared with interactive use,
so the cheapest model that does the job is the default ([vision](../product/vision.md) §The
constraint that shapes everything). Read-only exploration and proposal chats (`shape`, `define`, `research`)
run on Haiku. Brief refinement, grading, conflict resolution, and onboarding (`refine`, `review`,
`conflict`, `init`) run on Sonnet, where judgement matters over a small context. The two kinds that set quality run on
Opus: `adversary`, which has to find the flaw a weaker model misses, and `run`, which writes the
code. Model family names are stable; the exact ids are config, re-verified against current docs
before a release since the CLI moves fast ([claude-integration](./claude-integration.md)).

## Context policies

Three policies cover every kind:

- **reseed on stale** (chats). A chat resumes by session id across days or weeks. When the
  transcript is gone (Claude Code deletes idle ones after `cleanupPeriodDays`), the resume fails
  loud and the kind starts a fresh session seeded from the card
  ([claude-integration](./claude-integration.md) §Invocation model). The user loses transcript
  scroll-back, never the artifact: the brief is the product
  ([define-refine](../product/features/define-refine.md)).
- **always cold** (`adversary`, `research`, `review`, `conflict`). These kinds never resume. Each starts fresh
  and reads the finished artifact with no chat history, which is the point of the adversary pass: a
  cold reader catches what the author and the refine chat talked themselves past.
- **compact under pressure** (`run`). A run is the one session long enough to exhaust its context
  window mid-task. Near the limit the orchestrator compacts it: progress is summarized and the
  session resumes with that summary plus the brief reloaded, so the contract survives
  ([claude-integration](./claude-integration.md) §Context management).

## Interaction

Any session asks the user a question through `ask_user`: it records the question, the UI renders a
quick-reply form with a free-text fallback, and answering resumes the session with the answer. A
question arrives one at a time in dependency order and carries Claude's recommended answer, so the
user confirms or redirects, and anything the code can settle is read rather than asked
([define-refine](../product/features/define-refine.md) §Grilling). A run that calls it flips the
card to Needs input ([runs](../product/features/runs.md) §Needs input);
a chat kind renders the question inline in the drawer. This is the one interactive-question path, so
a mid-loop decision reaches the user the same way whichever stage raises it
([claude-integration](./claude-integration.md) §Board tools).
