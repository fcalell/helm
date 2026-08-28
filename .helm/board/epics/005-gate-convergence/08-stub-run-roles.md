---
id: 005-08
status: review
depends: [005-05]
sessions: {}
---
# Stub roles beyond refine and adversary

## Goal

The stub `claude` recognises every session kind an episode needs to drive, not just refine and
adversary. Today `roleOf` reads the role off two tool markers on `--allowedTools`, so a run, review,
shape or research spawn reaches the stub with no role, claims no script, and dies pre-init. Three
stories in a row have had to leave criteria ungraded for it: 003-09's shaping-decision path, which
needs a `shape` session to resume, 004-05's run timeline, which needs a run transcript to render,
and 004-07's card-arrival feedback, which needs a `define` session to create cards.

## Approach

Facts measured at Helm `59d490e`, clean on master.

- **The board tools on `--allowedTools` are the kind's registry row, verbatim.** `spawnSessionProcess`
  appends `mcp__helm__<name>` for each entry of `row.boardTools` (`runner.ts:132-136`), and one call
  site spawns every session, always with an `mcpUrl` (`sessions.ts:316-330`). Those names are on the
  command line of every spawn the harness can ever see.
- **The exact board-tool set already identifies the kind.** Measured over `KIND_REGISTRY`: init
  `{ask_user}`, shape `{ask_user, propose_epics, propose_stories, raise_decision}`, research `{}`,
  define `{ask_user, propose_stories}`, refine `{ask_user, contest_flag, resolve_question,
  update_brief}`, adversary `{ask_user, flag_risk}`, run `{ask_user, update_card}`, review
  `{grade_criteria}`. All eight are distinct. `conflict` carries no row at all, so it cannot spawn
  (`kinds.ts:255-259`).
- **So the answer is to derive the mapping, not to extend the table.** `ROLE_MARKERS`
  (`argv.ts:10-13`) is a hand-written two-row copy of data that already lives in `KIND_REGISTRY`;
  computing the mapping from the registry covers all eight kinds at once and stays correct when a
  kind's tools change. 004-08 gives refine `propose_stories`, which under a single-marker table
  would have made refine and define both answer to one marker; under set equality it changes
  nothing. A set that genuinely matched two kinds is a collision the derivation refuses at module
  load, so an ambiguous registry fails loudly instead of routing two kinds to one script.
- **Research is the empty set, and that is unambiguous.** A spawn with no MCP url would also carry
  no board tools, but no such spawn exists: `mcpUrl` is unconditional at the one call site.
- **Role is a synonym for kind, and the glossary calls that a defect.** `StubRole` collapses into
  `SessionKind`, and the script's `role` field becomes `kind`. Script files are already named
  `<role>-<ordinal>.json` (`script.ts:47-49`), so `refine-1.json` and `adversary-1.json` keep their
  names and every existing episode keeps its scripts; only the field inside them is renamed.
- **A stub run closes without emulating the Stop hook.** `evidenceClose` closes a run to review on a
  clean `result` frame alone; `state.hookPosted` is a second, independent piece of evidence
  (`runs.ts:754-783`). The stub emits its result frame and exits 0 at the end of every script
  (`stub.ts:174`), so a run script needs no hook machinery. The stub reads its script directory from
  `HELM_STUB_SCRIPTS` (`stub.ts:26`), not from cwd, so the run's worktree cwd changes nothing.
- **The scratch repo can carry a run.** It is a real git repo with a commit (`scratch.ts:140-150`),
  so the worktree, the branch and the review preflight's `rebaseOntoMain` have something to work on,
  and its `helm.config.json` configures no check command, so `captureCheck` is skipped. The one
  unmeasured assumption in this brief: that `rebaseOntoMain` and `diffStat` both succeed on a branch
  whose run touched no file. Nothing in the close path guards against an empty diff
  (`runs.ts:790-832`), and a failure of either lands as a `blocked` outcome the episode's assertion
  would name, so the risk is visible rather than silent.
- **Two of the three new kinds need a board fixture the scratch does not have.** A `shape` session
  attaches to a shaping thread and the scratch writes none; a `define` session attaches to an epic
  and `001-harness` already exists (`scratch.ts:98-122`). A run needs a story sitting in `ready`
  with a passed gate, which `ScratchOptions` already expresses.

**The shape.** `argv.ts` exports `kindOf(allowedTools): SessionKind | undefined`, which filters the
allowlist to its `mcp__helm__` names and matches the resulting set against each spawnable row of
`KIND_REGISTRY`; the lookup it matches against is built once at module load and throws there if two
rows share a set. `stubRoleSchema` and `StubRole` go away, `stubScriptSchema.role` becomes `kind`,
and `claimScript`, the stub log and the driver's declarations follow the rename. Three episodes
prove the derivation on the three kinds with a waiting consumer: `define-cards` spawns a define
session against `001-harness`, calls `propose_stories` with three drafts and accepts them;
`shape-decision` spawns a shape session against a new shaping-thread fixture, calls `raise_decision`,
and resolves the decision so the same session resumes; `run-close` takes a ready story through
`run.start` to a review close on the result frame alone. A fourth, `run-live`, halts with the run
held open on a `wait` step so an operator can grade the run timeline by hand, which is what regrades
004-05's three criteria. Steering kills the live segment and resumes the story in a fresh spawn
(`runs.ts:1147-1161`), so `run-live` declares two run scripts: the held one, which dies on the
steer's `killProcessGroup` with its `wait` unreleased, and `run-2.json`, which carries the steer
message into the timeline.

## Blast radius

`harness/stub-claude/argv.ts`, `harness/stub-claude/script.ts`, `harness/stub-claude/stub.ts`,
`harness/episode/driver.ts`, `harness/episode/episodes.ts`, `harness/episode/scratch.ts`, a
`harness/stub-claude/kinds-check.ts` the derivation criterion runs, and
`.helm/knowledge/architecture/claude-integration.md` §Verifying without burning the pool, whose
"claimed by role" sentence names the mechanism this changes. 004-05's story file, for the three
criteria this regrades. No `src/` change, no stack change.

## Acceptance criteria

- [x] `pnpm check` passes with zero errors (command)
- [x] No hand-written kind-to-tool table remains under `harness/`: `kindOf` derives its lookup from
      `KIND_REGISTRY`, and neither `StubRole` nor a `role` field survives in the stub, its script
      schema, or any episode fixture (file)
- [x] The lookup throws at module load when two registry rows share a board-tool set, named at its
      construction in `argv.ts` (file)
- [x] `kindOf` maps each of the eight spawnable kinds to itself:
      `node --experimental-strip-types harness/stub-claude/kinds-check.ts` prints eight matching
      lines and exits 0 (command)
- [x] `node harness/episode/run.ts all` passes, with every episode that passed at `59d490e` still
      present and still passing (command)
- [x] The `define-cards` episode's define spawn claims `define-1.json`, its `propose_stories` call
      lands, and accepting the three drafts writes three story files into the scratch board (file)
- [x] The `shape-decision` episode's shape spawn claims `shape-1.json`, its `raise_decision` call
      writes the item into the thread's Decisions checklist, and resolving the decision resumes the
      same session id (file)
- [x] The `run-close` episode's run spawn claims `run-1.json` and closes the story to review on its
      result frame with no Stop-hook POST, recording the review outcome in the story's `runs` entry
      (file)
- [x] No spawn in the four new episodes exits `NO_SCRIPT_EXIT`, and the stub log records the derived
      kind for every one of them (file)
- [x] A `compact` boundary emitted into a chat session renders its line in the chat surface, and the
      same boundary renders in the run timeline: 004-05's criterion, ungraded there for want of a
      run transcript (live)
- [x] Assistant text containing a list, a fenced code block, `**bold**` and a link renders as
      markdown in the run timeline as well as in a chat surface: 004-05's criterion (live)
- [x] Steering a run held open by `run-live` anchors the steer message at the top of the pane, the
      way a sent chat message does: 004-05's criterion (live)
- [x] Zero console errors across the board, a chat surface and the run timeline while `run-live`
      holds (live)
- [x] `claude-integration.md` §Verifying without burning the pool names the kind, not a role, and
      describes the derivation from the kind's board tools (file)
- [x] 004-05's three criteria are checked in its story file, with a run note saying `run-live`
      graded them (file)

## Out of scope

- Episodes for `init`, `research` and `review`. The derivation recognises all three the moment it
  lands; no story is waiting on one, and a fixture nobody reads is drift in waiting. The kind that
  first needs one writes it.
- The `conflict` kind. Its registry row carries no tools and no prompt, so `spawnableRow` throws
  before any of this is reached.
- Emulating the run's Stop and PreCompact hooks. The stub runs no hook commands, and the close path
  already treats a clean result frame as sufficient evidence.
- Permission presets inside a stub run: the held prompt, the permission tool, the Guarded and Manual
  allowlists. No criterion here reaches them.
- 004-07's acceptance feedback, which waits on the `define` kind this story delivers.
- The `roleOf` name surviving as an alias. The rename is the change; a compatibility shim would keep
  the synonym the glossary forbids.

## Run notes

- verify: `pnpm check` clean, 129 files, 0 errors
- verify: `node --experimental-strip-types harness/stub-claude/kinds-check.ts` prints eight `ok`
  lines plus `conflict not spawnable`, exit 0
- verify: `node harness/episode/run.ts all` → 20/20, the 17 that passed at `59d490e` plus
  `define-cards`, `shape-decision` and `run-close`
- verify: `node harness/episode/run.ts run-live` passes with an operator driving it, and the four
  live criteria were graded in Chrome against it (dark theme, zero console errors)
- The run kind needed two things beyond recognition, both found live. A stub run writes no CLI
  transcript, so nothing rehydrates and frames emitted before the operator opens the pane are
  simply lost: `run-live` holds on a sentinel first and streams into a pane that is already
  watching. And the stub never echoed its prompt, which the chat surfaces never noticed because
  they seed their own; a steer goes through `run.steer` with no local echo, so the steer message
  reached no pane at all. The stub now emits the CLI's user frame for a resumed turn.
- A steered segment is killed, not exited, so it writes no completion line to the spawn log. A
  spawn declaration takes `exit: null` for that.
- Run worktrees live at `~/.helm/worktrees/<repo basename>` and a review close keeps its worktree
  for the diff, so every run episode collided with the last one's leftovers. The scratch repo
  directory carries the episode name now, and `setupScratch` clears that worktree directory the
  way it clears the scratch root.
- The Diff tab answered `503` twice while `run-live` tore its worktree down. That is 002-09's
  carded defect (the pane keeps rendering "loading the diff" on a rejection), reached from a new
  direction, not a regression here.

## Open questions

- [x] Does this story regrade 004-05's three criteria, or do they stay unchecked until a story owns
      the run surface? Regrade them here: 004-05's review named this card as the place, and the run
      timeline is exactly what `run-live` stands up.
- [x] Do the new episodes cover the three kinds with a waiting consumer, or all eight spawnable
      kinds? The three. The derivation is total and carries no per-kind code, so an episode proves
      the mechanism rather than the row, and five fixtures with no reader would rot.
