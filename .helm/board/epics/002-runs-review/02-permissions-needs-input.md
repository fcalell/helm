---
id: 002-02
status: done
depends: [002-01]
branch: helm/002-02-permissions-needs-input
gate: { passed: 2026-07-20T09:04:40.675Z, brief: 86277dc90a59f7f0, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: 1a8aa5a7-d3e9-47fc-8217-a6b807683d67, brief: 86277dc90a59f7f0, started: 2026-07-20T09:07:52Z, outcome: review, grades: 9/10, tokens: 396394, minutes: 31.9 }
---
# Permission presets & needs-input

## Goal

Runs are supervised: the story's permission preset (Guarded default, Auto, Manual) shapes what
prompts, the Auto allowlist is per-repo data under `.helm/`, and a headless permission prompt
surfaces as approve/deny buttons on the card (`.knowledge/product/features/runs.md` §Permission
presets). A run's `ask_user` flips the card to Needs input, renders the quick-reply form in the
drawer, and the answer resumes the session (§Needs input); the notification leg stays v2.

## Approach

**Preset frontmatter.** `storyFrontmatterSchema` (`src/board/schema.ts`) gains an optional
`preset: "guarded" | "auto" | "manual"`; absent means Guarded, the default, so every existing card
keeps parsing and no migration exists. The writer's fixed key order becomes id · status · depends ·
branch · preset · gate · sessions · runs (`src/board/markdown.ts`, mirrored in
`.knowledge/architecture/board-storage.md`). A new `story.setPreset` RPC
(`src/worker/routes/story.ts`) writes the field through the write queue; it stays legal at any
status, because the preset is read once at spawn (a change during a live run takes effect on the
next attempt, the same semantics as a mid-run brief edit). The drawer header
(`src/app/components/card-drawer.tsx`) renders the three-way selector, showing Guarded when the
field is absent.

**Preset shapes the spawn.** The registry row's `tools` stays the canonical `AUTO_ALLOWLIST`
(`src/sessions/kinds.ts`); the runs service computes the effective allowlist per spawn and passes
it through a new `tools` override on `SpawnSessionOptions` (`src/sessions/runner.ts`), which
replaces `row.tools` while board tools keep appending from the row. Per preset:

- **Auto**: today's behavior. The allowlist (after the `.helm/` override below) plus the check
  command's `extraTools`; no prompt tool, non-allowlisted calls stay loudly denied.
- **Guarded**: allowlist is `Edit`, `Write`, `Read`, `Grep`, `Glob` (a new `GUARDED_ALLOWLIST`
  constant); file edits run free, and mutating Bash (git writes and the check command included)
  routes to the permission tool. Read-only Bash (`git status`, `git log`) never consults the
  tool, the CLI's own classification (claude-integration.md §Permission prompts), so under
  Guarded and Manual alike "prompts" means mutating calls; the spike below confirms where a
  non-allowlisted read-only command actually lands. `extraTools` stays empty: the check command
  prompting is the supervision, and the run prompt still names it: `runPrompt`
  (`src/sessions/prompts.ts`) gains the preset, so its check-command sentence says "on your
  allowlist" only under Auto and "it prompts for approval on this preset" under Guarded and
  Manual, never contradicting the widened denial sentence.
- **Manual**: allowlist is `Read`, `Grep`, `Glob` only; `Edit`/`Write`/Bash all route to the
  permission tool. (The CLI never consults the tool for its own read-only tools,
  `.knowledge/architecture/claude-integration.md` §Permission prompts, so reads stay free even
  here.)

Guarded and Manual spawns add `--permission-prompt-tool mcp__helm__approve` (new runner option,
set by the runs service) and treat the hold as two-ended, a client-side wait and an open
server-side HTTP response at once: `SpawnSessionOptions` gains an optional `env` merged over
`sessionEnv()`, and run spawns set `MCP_TOOL_TIMEOUT` (the CLI-side knob) to four hours. The
server-side ceiling is deliberately **measured, not assumed**: the recorded "held approval
survived 4 minutes on default env" is a success at 4 minutes on the spike's throwaway
`createServer`, not an observed limit, and the orchestrator actually mounts on the stack's
HTTP adapter (`ctx.http.mount`), whose hold behavior for a long-held response is unverified;
no Node default severs a held response (`requestTimeout`/`headersTimeout` bound receiving the
request, `server.timeout` defaults off), so whether any server-side ceiling exists, and which
adapter knob sets it, is exactly what the spike determines against the real server. If the
measured ceiling needs a knob the stack does not expose, that is a stack improvement per the
repo rule, never a workaround. A hold that still times out surfaces as a denied call inside
the session, the fallback claude-integration.md records. Spike-verify the load-bearing facts
before building, the 002-01 treatment, measured end-to-end against the orchestrator's real
HTTP server rather than the spike's own: the prompt-tool round trip over the streamable-HTTP
MCP endpoint (allow releases with `updatedInput`, deny blocks with the message), the hold
ceiling with `MCP_TOOL_TIMEOUT` raised (a hold must survive well past 5 minutes, and any
server-side limit found is named and raised), and where a non-allowlisted read-only Bash
command lands under a prompt tool (free per the CLI's read-only classification, or consulted).
The verified shapes land in the runner, the tool handler, and the server config.

**The `approve` permission tool.** `buildMcpServer` (`src/server/mcp/server.ts`) registers it for
`run` bindings only, beside the row's board tools; it is not a `BOARD_TOOLS` entry, because the
model never calls it, the CLI does, with `{tool_name, input, tool_use_id}` (loose schema). The
handler calls `recordPermission` on the proposals service (`src/server/services/proposals.ts`),
which owns the pending set the way it owns questions: it stores
`{id, storyId, toolName, input, createdAt}`, broadcasts, and returns a promise the tool handler
awaits. The proposal channel's snapshot (`src/server/mcp/schemas.ts` `proposalSnapshotSchema`)
gains a `permissions` array. A new `run.permission` RPC (`src/worker/routes/run.ts`) resolves one:
approve returns `{"behavior":"allow","updatedInput":<input>}` as the tool's text content, deny
returns `{"behavior":"deny","message":"denied from the board"}`. Pending permissions are in-memory
by design, like proposals: an orchestrator restart kills the run and reconciliation parks the card,
so nothing dangles. On the card (`src/app/components/story-card.tsx`), a story with a pending
permission renders the tool one-liner with approve/deny buttons calling `run.permission`. The
card root is itself the drag-and-select surface (`createDraggable`'s `dragActivators` spread on
the root beside its `onClick`/`onKeyDown`), so the button container isolates all three event
paths, not click alone: it stops `pointerdown` propagation (solid-dnd's activators listen there,
or a press-and-move on a button starts a card drag), `click` (the drawer open), and `keydown`
(Enter/Space on a focused button would bubble into the root's select handler).

**`ask_user` for runs, persisted on the entry.** The `run` row's board tools become
`["update_card", "ask_user"]`. For a `run` binding, the `ask_user` handler (`src/server/mcp/tools.ts`)
skips `recordQuestion` entirely and calls a new `runNeedsInput(storyId, payload)` on the runs
service (`src/server/services/runs.ts`): one queued write that stores the payload on the story's
open run entry as `question: {text, recommendation, options}` (new optional field on `runSchema`)
and flips `running → needs-input` when that transition is legal; when the user already moved the
card elsewhere, the question still lands on the entry (bookkeeping) and the status is left alone.
The handler awaits the write before returning, so the close handler always reads the flipped
status. Files stay the truth: the pending question survives an orchestrator restart in
frontmatter, which is exactly what the in-memory chat-question path cannot give a run, and the
run entry, not the proposals store, is what the UI renders. The run's system prompt
(`src/sessions/kinds.ts`) gains the `ask_user` contract: call it for a genuine mid-run decision
with a recommended answer, then end the turn; and its denial sentence widens to cover Guarded and
Manual, where a denied call is the user's decision, not a retry prompt.

**Close handling around needs-input.** `finishRun` decides per the open entry it re-reads in the
queue: a clean result whose entry carries a `question` is a segment end, not a finish; its queued
entry update still happens and carries the additive usage below, while deliberately writing no
`outcome` and leaving the status alone, and the per-story run state clears so the answer can
start the next segment (a pure early return here would lose segment 1's usage). Usage becomes
additive on every close branch, replacing 002-01's overwrite, because a result event's
`usage`/`duration_ms` counts only its own turn (`src/sessions/events.ts`); the sum is
absence-safe in both directions: with `segment` the branch's observed `result?.tokens`, the
update writes `tokens` only when `run.tokens` or `segment` is defined, as
`(run.tokens ?? 0) + (segment ?? 0)` (likewise `minutes`), so a branch that observed no usage
(the hook-only Review close, a killed run, an error result without `usage`) keeps 002-01's
field-omission instead of writing `NaN` (which `runSchema`'s `z.number()` rejects, throwing the
close write), a single-segment run keeps its current numbers, and a resumed run lands in Review
with both segments counted. `finishRun`'s entry match switches from `run.session ===
state.sessionId` to the open entry (the `outcome === undefined` `findLast` that the resume's
init write and `reconcileRunning` already use): the two keys must name the same entry for
same-`n` accounting, and matching by session id would hang that on resume id-stability, a fact
spike-verified only for chat resumes in the main checkout; one match key removes the dependency
instead of spiking it. The outcome mapping keeps 002-01's shape, with
one extension: a non-clean exit while the status reads `needs-input` (a crash inside the
ask_user turn) parks the card in Blocked with the error, the truthful state, while the question
stays on the entry as record. Boot reconciliation needs no new branch: the pid sweep is
status-independent, only `running` cards park, so a needs-input card crosses a restart intact.

**Answering resumes the run.** A new `run.answer` RPC (`run.answer {id, answer}` in
`src/worker/routes/run.ts`, handled by the runs service) is the one path, chat's
`proposal.answer` never sees run questions: it requires status `needs-input` and an open run
entry carrying a `question`. Its concurrency guard is deliberately not `run.start`'s
`states.has` check, because the card turns answerable at the ask_user write, while the asking
process is still alive (it ends its turn only after the tool returns) and its teardown (result,
git work, segment-end entry write, `cleanup`) has not run, so the bare check would flake
`RUN_ACTIVE` on exactly the answer the feature serves. Two hazards, one slot: the asking
process's teardown must be waited out, and two answers must never both spawn (a double-tap or
an RPC retry would resume the same session id twice into one worktree). `states` stays the
single per-story slot for both. `run.answer` first awaits any existing state's close
completion, via a `closed` promise the run state exposes, resolved after `cleanup`, bounded by
a 60-second timeout (the spawn-to-init standard: one wait never wedges the path); a state
still unresolved at the bound means a process that asked without ending its turn, or a
hand-typed `needs-input` under a genuinely live run, and rejects with `RUN_ACTIVE`. Then it
claims the slot exactly the way `startRun` does: a synchronous `states.has` check-then-set
with no `await` between wait-wake and claim, so of two concurrent answers the first to wake
claims and the second finds the slot taken and rejects `RUN_ACTIVE`, before either spawns.
The status and entry re-checks inside the resume's queued init write remain the authority on
what the claim ultimately does; the slot only guarantees one claimant. It re-converges the worktree via `ensureWorktree` (idempotent; covers an
out-of-band worktree delete, since session lookup survives a recreated path), rebuilds the
settings file, computes the preset allowlist fresh, and resumes the entry's `session` id through
`spawnRunSession`, which gains a `resume` option riding `spawnTracked`'s existing plumbing, with
`questionAnswerPrompt(question, answer)` as the prompt. On `system/init` one queued write
re-checks status `needs-input` with the entry still open, then flips to `running` and deletes
`question` from the entry; that write is assigned to the resume's `state.initWrite` and returns
the same `"armed"` / `"aborted"` sentinel `startRun`'s does, because `finishRun`'s arming guard
bypasses all close handling (no outcome, no status flip) when `initWrite` is absent or not
`"armed"`; the write cannot be copied from `start()` since its re-check differs (`needs-input`
with the entry open, not `ready` plus gate freshness), but the arming contract is identical. The
close path is then `finishRun` (with the additive usage above), so the finished resume flips to
Review with the same `n`, and gate freshness is deliberately not re-checked: the contract is the
spawn snapshot, and a mid-run brief edit never rewrites it. The needs-input drawer renders
the quick-reply form from the entry's question (recommendation chip plus options plus free text,
the question-widget pattern fed from frontmatter), posting `run.answer`.

**Auto allowlist as per-repo data.** A repo overrides or extends the canonical list with
`.helm/permissions.json` (layout entry in board-storage.md): a strict-schema file
`{ "auto": { "extend": [...] } | { "replace": [...] } }`, patterns validated non-empty and
comma-free (the runner joins `--allowedTools` on commas, the same constraint `checkCommand`
carries). The runs service reads it from the main checkout at spawn (a new small reader beside
`src/server/config.ts`'s pattern); a missing file means canonical, an invalid one fails
`run.start` loudly, because a run must never spawn on a guessed allowlist. It shapes the Auto
preset only. `.knowledge/product/features/runs.md` §Permission presets gains the concrete file
name.

## Blast radius

- `src/board/schema.ts`: `preset` on story frontmatter; `question` object on `runSchema`.
- `src/board/markdown.ts`: `preset` in the fixed frontmatter key order.
- `src/sessions/kinds.ts`: `GUARDED_ALLOWLIST` / `MANUAL_ALLOWLIST` constants, `ask_user` joins
  the run row, run system-prompt additions (ask_user contract, preset-aware denial sentence).
- `src/sessions/runner.ts`: `tools` override, `permissionPromptTool`, and `env` spawn options.
- `src/server/services/runs.ts`: preset → allowlist/prompt-tool/env at spawn, the permissions
  file read, `runNeedsInput`, the needs-input close branch, additive entry usage on the
  open-entry match, `answerRun` (resume path).
- `src/sessions/prompts.ts`: `runPrompt` gains the preset for its check-command sentence.
- `src/server/services/sessions.ts`: `spawnRunSession`'s input and `spawnTracked`'s options both
  gain `resume`, `tools`, `permissionPromptTool`, and `env`, threaded through to
  `spawnSessionProcess`; today no path carries the three preset options from the runs service to
  the runner.
- `src/server/services/proposals.ts`: pending-permission set (`recordPermission`,
  `resolvePermission`), snapshot broadcast.
- `src/server/mcp/server.ts`: registers `approve` for run bindings; `src/server/mcp/tools.ts`:
  run-aware `ask_user`; `src/server/mcp/schemas.ts`: permission entry + snapshot widening.
- `src/worker/routes/run.ts`: `permission`, `answer`; `src/worker/routes/story.ts`: `setPreset`;
  regenerated route index.
- `src/app/`: drawer preset selector + needs-input quick-reply panel (`card-drawer.tsx`, new
  panel component), card approve/deny buttons (`story-card.tsx`), `session-store.ts`/`api.ts`
  plumbing for the new RPCs and snapshot field.
- `.knowledge/architecture/board-storage.md`: key order, `question` field, `permissions.json`
  layout entry. `.knowledge/product/features/runs.md`: the override file's name and shape.
- The server-side hold ceiling the spike measures on the stack's HTTP adapter, if one exists:
  raised where the stack exposes the knob, a `../stack` improvement if it does not.
- `helm.config.example.json`, `src/server/config.ts`: untouched (the override file is per-repo
  `.helm/` data, not orchestrator config).
- Untouched: gate service, dispatcher, board watcher/store/loader, worktrees module.

## Acceptance criteria

- [ ] A story with no `preset` field spawns Guarded; `story.setPreset` writes
  `preset: auto|manual|guarded` in the fixed key order, and the drawer selector round-trips it.
- [ ] A Guarded run edits files with zero prompts, and its first git commit surfaces a pending
  permission on the proposal channel; `run.permission` approve releases the exact commit
  (`git log` shows it), and a deny lands in the session stream as the denial message.
- [ ] A Manual run's first `Edit` call prompts too (approve releases the edit).
- [ ] An Auto run with `.helm/permissions.json` extending the allowlist executes the added
  command prompt-free; a file carrying a comma pattern fails `run.start` with a loud
  validation error and no spawn.
- [ ] A run's `ask_user` flips the card `running → needs-input`, the payload lands as the open
  run entry's `question` in frontmatter, and the process exit writes no `outcome`.
- [ ] After an orchestrator restart, the needs-input card still shows the question (read from
  frontmatter) and `run.answer` still resumes the session.
- [ ] `run.answer` resumes the same session id in the worktree with the answer, clears
  `question`, flips to `running`, and the finished resume lands in Review with
  tokens/minutes accumulated across both segments on the same run entry `n`.
- [ ] `run.answer` on a story that is not `needs-input`, or with a run already active, is
  rejected; `messageSession` still rejects run sessions.
- [ ] The needs-input drawer renders the quick-reply form (recommendation chip, options, free
  text) and answering it drives the resume; the card's approve/deny buttons resolve a pending
  permission without opening the drawer.
- [ ] The spike evidence (prompt-tool round trip over streamable HTTP, a hold surviving well
  past 5 minutes with `MCP_TOOL_TIMEOUT` raised and any measured server-side limit named and
  raised, the read-only Bash classification under a prompt tool) is recorded in
  `.knowledge/architecture/claude-integration.md` §Permission prompts, measured against the
  orchestrator's real HTTP server.

## Out of scope

- Notifications for prompts and needs-input → v2 (`.knowledge/product/features/mobile.md`).
- Activity timeline, steering, pause/stop UI, and the mid-run brief-edit notice → 002-03.
- Queue/dispatcher routing for runs and resumes, concurrency cap, rate-limit meter → 002-04;
  `run.answer` spawns directly the way `run.start` does.
- Compaction → 002-05; review surfaces and exits → 002-06/07; button-first board retrofit →
  002-08 (this story ships only the three run-supervision controls: preset selector,
  approve/deny, quick-reply).
- Pending-permission persistence across restart: in-memory by design; the restart kills the run
  and reconciliation parks the card.
- The deny-with-reason + needs-input-resume fallback for holds longer than the raised timeout:
  recorded in claude-integration.md, built only if hour-plus holds prove real.
- Per-preset allowlist overrides beyond Auto (`guarded`/`manual` blocks in `permissions.json`).

## Open questions

None open; the scope calls above (question persisted on the run entry rather than the proposals
store, permissions in-memory, Guarded prompting for the check command) are settled in Approach.
