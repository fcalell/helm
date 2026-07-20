---
id: 002-06
status: done
depends: [002-01]
branch: helm/002-06-review-diff-checklist
gate: { passed: 2026-07-20T23:19:05.000Z, brief: 013c674e9617b2cd, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: d603a0d1-532d-4aaa-96dc-9b3e06a74508, brief: 013c674e9617b2cd, started: 2026-07-20T23:20:00.000Z, outcome: review, grades: 10/10, tokens: 400666, minutes: 15.6 }
---
# Review: rebase, diff & checklist

## Goal

A card in Review opens on the checklist-first Diff tab: the story branch is rebased onto the
repo's main branch before the card flips to Review (a conflict parks it Blocked with the error),
the drawer renders the diff per file side by side under the brief's ungraded acceptance-criteria
checklist, and the run's verification evidence is surfaced: an orchestrator-run check-command
result plus the run's own verify notes. Self-grading, the standards axis, and the `conflict`
session are v2; no review sessions spawn (`.knowledge/product/features/review.md`).

## Approach

Facts, verified against the tree at `e690ceb`:

- The close path is `finishRun()` in `src/server/services/runs.ts` (~526-684): teardown runs
  `safetyCommit` and the `helmDiffPaths` guard, `evidenceClose()` (~590) maps evidence to
  `{ outcome: "review" | "blocked", error? }`, and one queued write (~612-677) closes the open
  entry and flips a `running` card to the outcome. A pending `question`, a steer, or a pause
  keeps the entry open (`close = undefined`); `state.intent === "stop"` closes blocked.
- Git runs through `execFileAsync("git", ["-C", cwd, ...])` in `src/server/worktrees.ts`
  (`git()`, ~12-22). No rebase, merge, or diff-parsing code exists anywhere yet.
- `ManagedRepo` is `{ path, mainBranch, checkCommand? }` (`src/server/config.ts:17-22`).
  `checkCommand` is a shell string; today only the run agent executes it, and its output is never
  captured.
- The brief snapshot lives at `<worktreesDir>/<storyId>.brief.md` (`briefFilePath`,
  `runs.ts:110-112`), written at fresh start, read by `resumeSeed`.
- The client already holds every story's parsed brief: `storySchema` embeds `body` and `brief`
  (criteria via `parseBrief`, `src/board/markdown.ts:54-86`), streamed on the `board` channel.
  `src/board/` imports cleanly in the browser (`briefHash` already does).
- The drawer's Diff tab is a stub (`EmptyState`, `src/app/components/card-drawer.tsx:251-259`);
  `defaultTab` already returns `"diff"` for `review`. `ChecklistSection` (same file, ~39-74)
  renders a `ChecklistItem[]` read-only. RPC goes through `api` (`src/app/lib/api.ts`); a new
  route file under `src/worker/routes/` joins the router through the `stack generate` barrel.
- `review: ["done", "running", "ready", "blocked"]` and `running: [..., "review", "blocked"]`
  are already legal transitions (`src/board/transitions.ts:9-18`).

Build on those anchors:

**Rebase at the review close.** Exactly the closes that would land `outcome: review` (a clean
completion with no pending question, no teardown error, no stop intent) first rebase the story
branch: `git rebase <mainBranch>` in the worktree, after `safetyCommit` so the tree is clean. An
up-to-date branch is a no-op. On any failure, run `git rebase --abort` (best effort) so the
worktree is left on the pre-rebase tip with no rebase in progress, and the close becomes
`{ outcome: "blocked", error: "rebase on <mainBranch> failed: <stderr tail>" }`, which the
existing write already parks Blocked. Structure the decision so the rebase and the check below
run outside the write queue (the queue never waits on git or a test suite; the close write lands
after both); a fresh pre-read for the pending-question case is fine, the queued write stays the
authority.

**Check capture.** After a successful rebase, when `checkCommand` is configured, run it in the
worktree (shell spawn, worktree cwd, 10-minute cap, kill the process group on timeout) and write
`<worktreesDir>/<storyId>.check.json`: `{ command, exitCode, output, finishedAt }` with `output`
the last ~16k characters of interleaved stdout+stderr and `exitCode: null` on timeout. A failing
or timed-out check still lands the card in Review: the check is evidence for the reviewer, not a
gate. No configured command writes no file. The close write (and so the flip to Review) waits on
the check; a run already takes tens of minutes, the extra minute buys the reviewer a verdict on
the rebased code, which is what merges.

**Diff stat on the entry.** The same close computes `git diff --shortstat <mainBranch>...HEAD`
and writes `stat: "N files +A -D"` onto the closing entry (`runSchema` gains an optional `stat`
string, `src/board/schema.ts:40-58`); the card face shows it while the story is in Review
(board.md §Card anatomy).

**`review.get`.** New route group `src/worker/routes/review.ts` with one procedure. Input
`{ storyId }`; requires status `review` and an existing worktree, else `NOT_FOUND`. Returns
`{ briefBody, check, files }`: `briefBody` from the spawn snapshot file when present, else the
live card body; `check` from `<storyId>.check.json`, `null` when absent; `files` parsed from
`git diff -M <mainBranch>...HEAD` in the worktree, one entry per file:
`{ path, oldPath?, status: "added" | "modified" | "deleted" | "renamed", binary, additions,
deletions, hunks: [{ header, lines: [{ kind: "context" | "add" | "del", oldLine?, newLine?,
text }] }] }`. Parse tolerantly (the `parseCompactBoundary` precedent): a line the parser cannot
place drops the file to a `binary`-style stub rather than throwing.

**Diff pane.** A new `src/app/components/diff-pane.tsx` replaces the stub for `review` cards
(other statuses keep the `EmptyState`) and fetches `api.review.get` when shown. Top to bottom:
the acceptance-criteria checklist parsed from `briefBody` (reuse `ChecklistSection`, ungraded),
a verification block (the card's `## Run notes` bullets plus the check verdict as a pass / fail /
timed out / "No check command configured" line with the output behind a collapsible `<pre>`),
then one collapsible section per file: header `path · status · +A −D`, body a side-by-side grid
pairing consecutive del/add runs row by row with old/new line numbers, context rows spanning
both columns. Monospace, red/green tinted, hand-rolled; no diff or markdown dependency.

**Run notes as verification steps.** `RUN_PROMPT` (`src/sessions/kinds.ts:85`) gains a closing
requirement: before finishing, record run notes through `update_card` stating the check command's
outcome and one `verify:` bullet per behavior a human must check by hand. `appendRunNote`
collapses each note to one bullet line, which fits.

**Docs.** `api.md`: add the `review.get` row and note in the `run.start` row that the close path
rebases on main before Review, a conflict parking Blocked. `board-storage.md`: the `stat` entry
field and the `<storyId>.check.json` artifact next to the brief snapshot. `runs.md` §Run
lifecycle: the rebase and check capture at close. `review.md` already describes this surface;
correct any line the implementation contradicts rather than duplicating it.

## Blast radius

`src/server/services/runs.ts` (close path), `src/server/worktrees.ts` (rebase, shortstat, diff
helpers), new `src/worker/routes/review.ts` plus the regenerated route barrel,
`src/board/schema.ts` (`stat`), `src/sessions/kinds.ts` (`RUN_PROMPT`),
`src/app/components/card-drawer.tsx` plus new `diff-pane.tsx`, the board-card component (stat on
the Review face), and the four docs named above. No change to spawn, resume, queue, or gate
paths.

## Acceptance criteria

- [ ] A clean run close on a branch behind main lands the card in Review with the branch rebased
      (main's tip is an ancestor of the worktree's HEAD); an already-up-to-date branch lands in
      Review unchanged.
- [ ] A conflicting rebase leaves the worktree on the pre-rebase tip with no rebase in progress,
      closes the entry `outcome: blocked` with an error naming the rebase, and parks the card
      Blocked.
- [ ] Steer, pause, needs-input, and stop closes run no rebase and no check: the branch is
      untouched and no `<storyId>.check.json` appears.
- [ ] A review close with a configured check command writes `<worktreesDir>/<storyId>.check.json`
      carrying the command, exit code, and capped output; a failing check still lands the card in
      Review.
- [ ] The closed entry carries `stat` (`"N files +A -D"`) matching `git diff --shortstat`, and
      the Review card face shows it.
- [ ] `review.get` on a Review card returns the snapshot brief body, the check evidence (`null`
      when unconfigured), and per-file hunks with old/new line numbers, per-file additions and
      deletions, and rename/added/deleted statuses; on a story not in `review` it rejects
      `NOT_FOUND`.
- [ ] The Diff tab on a Review card renders the ungraded criteria checklist on top, the run's
      `verify:` notes and the check verdict with collapsible output, and each changed file as a
      collapsible side-by-side diff with line numbers; non-review statuses keep the current stub.
- [ ] `RUN_PROMPT` requires closing run notes: the check outcome plus one `verify:` bullet per
      by-hand check.
- [ ] `api.md`, `board-storage.md`, and `runs.md` describe the rebase-at-close, the check
      artifact, `stat`, and `review.get`; no doc still implies review opens without a rebase.
- [ ] `pnpm check` passes.

## Out of scope

- The three review exits and every cleanup they own, including deleting `<storyId>.check.json`
  and the brief snapshot (002-07).
- Self-grading, the standards axis, the `conflict` session, and evidence-click jump-to-lines
  (v2, review.md).
- The History tab, markdown rendering, a unified single-column diff for narrow screens, and diff
  virtualization for huge files.
- Diff stats anywhere but the Review card face and the drawer.

## Open questions
