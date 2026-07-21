---
id: 002-07
status: done
depends: [002-06]
branch: helm/002-07-review-exits
gate: { passed: 2026-07-20T23:52:17.000Z, brief: d3d42e6c0f5d321c, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: ff5cac3b-a6d4-40f0-8d09-02904431280f, brief: d3d42e6c0f5d321c, started: 2026-07-20T23:53:30.000Z, outcome: review, grades: 12/12, tokens: 419333, minutes: 14.3 }
---
# Review exits

## Goal

The three exits close the loop (`.knowledge/product/features/review.md` §Three exits): **approve**
re-rebases if main moved, fast-forward-merges the story branch into the managed checkout's main,
pushes best-effort, deletes the worktree, branch, and per-story artifacts, card to Done;
**request changes** turns the user's comments into the next message in the same session and
worktree with the follow-up routed to Fable at high effort, card to Running; **discard** deletes
the worktree, branch, and artifacts, keeps the brief and run history, card to Ready.

## Approach

Facts, verified against the tree at `3cb1f89`:

- `src/worker/routes/review.ts` holds `review.get`; the three exits join it as procedures in the
  same file. Routes regenerate into the barrel through `stack generate` (`pnpm generate`).
- The resume machinery is `ResumeSpec` (`src/server/services/runs.ts:858-862`:
  `precheck(current) → { session, prompt }`, `recheck(fresh) → frontmatter | undefined`,
  `abort`), driven by `resumeRun` (~877) and `resume()` (~1124), which re-converges the worktree,
  rides `resumeSeed` (the brief snapshot) on the system prompt, and arms the init write.
  `answerRun` (~910) shows the full pattern including `dispatchRun(storyId, true, …)`, the
  front-enqueued continuation.
- Model and effort come only from the kind registry: `spawnSessionProcess` reads `row.model` /
  `row.effort` (`src/sessions/runner.ts:126-129`); `spawnRunSession`
  (`src/server/services/sessions.ts:377-410`) and `spawnTracked` have no override field.
- Git helpers live in `src/server/worktrees.ts`: `git()` (execFile wrapper), `ensureWorktree`,
  `rebaseOntoMain` (aborts on failure, throws `"rebase on <main> failed: …"`), `diffStat`,
  `worktreeExists`, `worktreePath`. No merge, push, worktree-remove, or branch-delete helper
  exists.
- Per-story artifacts under `worktreesDir`: `<id>.brief.md` (`briefFilePath`), `<id>.check.json`
  (`checkFilePath`), `<id>.settings.json`, `<id>.pid` (all in `runs.ts:100-130`).
- Live-run guards: `states` (in-memory run state per story) and `waitingRuns` plus `runActive()`
  (`runs.ts:1101`); `review: ["done", "running", "ready", "blocked"]` is already legal
  (`src/board/transitions.ts`). `story.move` refuses moves into `running`, so request changes
  re-arms through the run lifecycle like `run.answer`.
- The run entry reopens by clearing `outcome` (the close path keys "open" on
  `outcome === undefined`, `runs.ts:741`); `addUsage` then keeps summing segments onto it, and
  the next review close re-runs rebase/check/`stat` unconditionally.
- UI: exits render for `review` cards in the drawer (`src/app/components/card-drawer.tsx`; the
  Diff tab is `diff-pane.tsx`); actions call `api.review.*` (`src/app/lib/api.ts` client, see the
  `api.run.*` call sites in `src/app/lib/session-store.ts:305-364`). The stack UI kit exports
  `dialog`, `danger-zone`, `checkbox`, `textarea`, `field`, `toast`.
- `managedRepo()` returns `{ path, mainBranch, checkCommand? }`; the checkout's current branch
  reads via git the way `src/worker/routes/repo.ts` does.

Build on those anchors, exits first, in `src/server/services/review.ts` (a new service the route
file calls; `runs.ts` keeps the run lifecycle):

**Shared exit preconditions.** Each exit does a fresh story read: status must be `review`, else
`ILLEGAL_TRANSITION`; a live or queued run (`states` / `waitingRuns`) rejects `RUN_ACTIVE`. Git
failures reject with a new `EXIT_FAILED` code (409) carrying the git error text, and the card is
left unchanged: exits are interactive, so a failure is a toast for the user, unlike the
unattended close path that parks Blocked.

**Approve.** Requires the worktree (`NOT_FOUND` when gone). Steps: `rebaseOntoMain` in the
worktree (main may have moved since review opened; a conflict rejects `EXIT_FAILED`, worktree
left on the pre-rebase tip). Then in the managed checkout: refuse `EXIT_FAILED` when its current
branch is not `mainBranch`, else `git merge --ff-only <storyBranch>` (always fast-forwardable
after the rebase; any refusal rejects `EXIT_FAILED`). The merge is the point of no return: after
it, push and cleanup failures never park the card. Push only when `mainBranch` has an upstream
(`git rev-parse --abbrev-ref <mainBranch>@{upstream}`); the return is
`{ pushed: boolean, pushError? }` and a failed push leaves the merge intact. Cleanup, best
effort with errors logged: `git worktree remove --force`, `git branch -d`, delete the four
per-story artifacts. One queued write sets `status: done`; the merge already happened, so this
write does not re-validate the status away.

**Discard.** Tolerates a missing worktree (deletes what exists): `git worktree remove --force`,
`git branch -D` (unmerged), delete the same artifacts, one queued write sets `status: ready`.
The closed entry stays untouched (outcome, `stat`, tokens: the run history is the point); the
`gate` block still matches the brief, so the story is immediately runnable again and the next
`run.start` appends entry n+1 on a fresh worktree.

**Request changes.** Procedure input `{ storyId, comments }`, `comments` a non-empty array of
`{ criterion?, text }` (empty rejects as oRPC `BAD_REQUEST`). It builds a `ResumeSpec`:
`precheck` requires status `review` and a last entry with `outcome: "review"` (a blocked entry
has nothing to resume into review), returning that entry's `session` and
`requestChangesPrompt(comments)`; `recheck` reopens the entry (drop `outcome`, `error`, and
`stat`) and flips `status: "running"`; dispatch through `dispatchRun(storyId, true, …)` like
`answerRun`. The prompt (in `src/sessions/prompts.ts`) states: the review returned change
requests, the session continues in the same worktree, the branch was rebased onto main at the
last close so commit ids may differ from its memory, address every item, re-run the check
command, finish with fresh run notes (check outcome plus `verify:` bullets). Items render as
bullets, per-criterion ones quoting the criterion text.

**Tier routing.** Add optional `model` and `effort` overrides to `SpawnSessionOptions` (used in
place of the registry row when set) and thread them through `spawnTracked` → `spawnRunSession` →
`resume()`; no other spawn path passes them, so every other kind is untouched. Request changes
resumes on `model: "fable", effort: "high"`: the v1 payload always carries user comments, which
is the escalation case of session-kinds.md §Model per kind; the Sonnet-at-medium branch triggers
only on a standards-findings-only payload, which arrives with the v2 standards axis, so no dead
branch is built now.

**UI.** `card-drawer.tsx` renders an exit bar for `review` cards (visible whatever the active
tab): Approve, Request changes, Discard. Approve and Discard confirm in a dialog first (Discard
with destructive framing: the worktree and branch are deleted, the brief and run history stay).
Request changes opens a dialog listing the story's criteria (`story.brief.criteria`), each with
an optional comment field, plus one free-form textarea; submit sends the non-empty ones and
requires at least one. Buttons disable while a call is in flight; failures toast the error
message verbatim. After a successful request-changes the drawer follows the card's new status
(`defaultTab` already sends `running` to Activity). After approve or discard the board snapshot
moves the card; no optimistic state.

**Docs.** `api.md`: three procedure rows and the `EXIT_FAILED` error row.
`board-storage.md`: exits delete the per-story artifacts; the request-changes reopen (outcome,
error, and `stat` cleared, usage keeps accumulating). `review.md`: align v1 behavior where it is
silent (push is best-effort; an approve-time conflict returns the error and leaves the card in
Review). `session-kinds.md` already states the routing rule; leave it.

## Blast radius

New `src/server/services/review.ts`; `src/worker/routes/review.ts` (three procedures) plus the
regenerated barrel; `src/server/worktrees.ts` (merge/push/remove/delete helpers);
`src/server/services/runs.ts` (export or reuse of the resume machinery for the request-changes
spec); `src/sessions/prompts.ts` (`requestChangesPrompt`); `src/sessions/runner.ts` +
`src/server/services/sessions.ts` (model/effort override); `src/app/components/card-drawer.tsx`
(exit bar + dialogs, possibly a new `review-exits.tsx` component); `api.md`,
`board-storage.md`, `review.md`. No change to the close path, queue, gate, or chat kinds.

## Acceptance criteria

- [ ] Approve on a Review card whose main moved since the close re-rebases the branch,
      fast-forward-merges it into the managed checkout's main, and lands the card Done; the
      story's tip is reachable from `mainBranch`.
- [ ] Approve pushes when `mainBranch` has an upstream and reports `{ pushed }`; a missing
      upstream or a failed push completes the exit with `pushed: false` and the merge intact.
- [ ] A conflicting approve-time rebase rejects `EXIT_FAILED`, leaves the card in Review, the
      worktree on the pre-rebase tip with no rebase in progress, and `mainBranch` untouched.
- [ ] Approve and discard both remove the worktree, delete the story branch (discard with `-D`
      on an unmerged branch), and delete the story's `worktreesDir` artifacts (brief snapshot,
      check file, settings, pid); discard tolerates an already-missing worktree.
- [ ] Discard lands the card Ready with the closed entry (outcome, `stat`, tokens) kept, and a
      following `run.start` succeeds on the still-valid gate, appending a fresh entry.
- [ ] Request changes resumes the last entry's session id in the same worktree with
      `--model fable --effort high` on the spawned CLI args, reopens the entry (`outcome`,
      `error`, `stat` cleared), and flips the card Running on init; the prompt carries every
      comment, per-criterion ones quoting the criterion, plus the rebased-branch notice.
- [ ] The follow-up's close sums its tokens and minutes onto the same entry and re-runs
      rebase/check/`stat` through the unchanged close path.
- [ ] All three exits reject `ILLEGAL_TRANSITION` off-status and `RUN_ACTIVE` under a live or
      queued run; request changes rejects an empty comment list; approve without a worktree is
      `NOT_FOUND`.
- [ ] The registry rows still rule every spawn that passes no override: only the
      request-changes resume emits an effort differing from its kind's row.
- [ ] The drawer shows the three exits on Review cards only; approve and discard confirm first;
      the request-changes dialog offers per-criterion and free-form comments and requires at
      least one; in-flight calls disable the bar; a rejected exit toasts the error message.
- [ ] `api.md` documents the three procedures and `EXIT_FAILED`; `board-storage.md` documents
      the artifact deletion and the entry reopen; `review.md` matches the shipped v1 behavior.
- [ ] `pnpm check` passes.

## Out of scope

- PR mode (`gh` instead of merge+push), the `conflict` session, self-grading and the standards
  axis with its findings-only Sonnet tier (v2, roadmap.md); serialized multi-story merges
  (single run at a time in v1).
- A diff view for Done cards (the worktree is gone; History tab is its own backlog item).
- Notifications on exit, and any change to the status-driven card-face actions (002-08).

## Open questions
