---
id: 003-09
status: done
depends: []
gate: { passed: 2026-08-27T13:26:46.625Z, brief: 704a82b84ccc18da, overrides: [] }
sessions: {}
---
# Wrapped checklist items

## Goal

A checklist item that wraps across lines parses as the whole item. Today `parseChecklist` reads the
first line and drops the rest, so a wrapped acceptance criterion loses the verification-mode tag
that sits on its last line and a wrapped open question or shaping decision can never be matched by
the tool that checks it off. The repo's own 100-column prose rule makes wrapping the normal case,
so the parser and the writing rule are in direct conflict and the loop's gate, grader and board
tools all read truncated text.

## Approach

Facts measured at Helm `51176c0`, clean on master.

- **The gate rejects every real brief.** `checkReadyGate` (`transitions.ts:36-46`) fails a brief
  holding any criterion whose `mode` is undefined. Run against the board as it stands, three
  gate-passed stories fail: 004-04 at 7 untagged criteria, 004-05 at 11, 005-07 at 10 — every one
  of them a criterion whose `(live)` or `(file)` tag sits on a continuation line. No brief written
  to the repo's own wrapping rule can legally reach ready.
- **The cause is one line.** `parseChecklist` (`markdown.ts:45-55`) iterates lines and keeps only
  those matching `CHECKLIST_RE` (`schema.ts:158`), which anchors at `^`. A continuation line
  matches nothing and is discarded, so the item's `text` ends at the first line break.
  `parseCriteria` (`:62-72`) then looks for the mode tag with a `$`-anchored regex against that
  truncated text and finds nothing.
- **Truncated text is not only the gate's problem.** The grader keys criteria by exact `text`
  (`grader.ts:144,158,175`), the review comments key by it (`review-exits.tsx:166`), and the card
  face and drawer display it — so a wrapped criterion reaches the grading session as half a
  sentence whose meaning can invert at the break.
- **Three mutators match by exact text and silently no-op.** `resolveDecision` (`:283-315`),
  `questionFolds` (`:337-350`) and `checkQuestion` (`:435-450`) each scan lines with the same
  regex and compare the first line against a caller-supplied target. A wrapped open question can
  therefore never be checked off by `resolveQuestion`, and a wrapped shaping decision never by
  `resolveDecision`: both return undefined, which reads to the caller as "no such item" rather than
  as a parse failure.
- **Four copies of the same scan.** `markdown.ts` runs `CHECKLIST_RE` over lines at `:48`, `:301`,
  `:348` and `:441`, each with its own loop. Folding continuations into each copy separately would
  put the same rule in four places; one scanner that yields an item's mark, folded text, and the
  line range it spans serves the reader and all three mutators, which need the range anyway to
  rewrite `[ ]` in place.
- **What counts as a continuation is decidable from the line alone.** Inside a checklist, a line
  that is non-empty, indented, and not itself a checklist item or a heading continues the item
  above it. A blank line, a new `- [ ]`, or a heading ends it. Nothing in the board format puts an
  indented non-checklist line under a checklist item for any other purpose.
- **No board file changes.** The fix makes the files already on disk parse correctly; nothing is
  migrated or rewritten.
- **The fold match survives by construction.** `questionFolds` (`:337-364`) keeps an Approach line
  whose text starts with `- <question>:`, comparing against the checked question. Once the reader
  folds, the compared question is the whole question, and `resolveQuestion` (`:452-464`) writes the
  fold line as one unwrapped line, so the two still agree. A fold line wrapped by hand would not
  match, which is the pre-existing trait of every hand edit the watcher accepts, not something this
  change introduces.
- **The harness is the automated test.** This repo has no test runner: `pnpm check` is type-check
  plus lint, so it proves compilation and nothing about parsing. Behaviour is graded by
  `harness/episode/episodes.ts`, whose assertions run against a real orchestrator on a scratch
  board at zero pool cost, and that is what a `(test)` criterion here means.
- **The episode driver already fails on an invalid board file** (`1118669`), so a wrapped question
  resolved through a board tool is reachable at zero pool cost in the existing harness rather than
  by reading.

**The shape.** One line scanner in `markdown.ts` walks a body or section and yields each checklist
item as its mark, its folded single-line text, and its start and end line indices. `parseChecklist`
maps it; `resolveDecision`, `questionFolds` and `checkQuestion` match against the folded text and
rewrite the item's *first* line, which is where the `[ ]` is. Folding joins continuation lines with
a single space, so the folded text is what the author wrote as one sentence and the `$`-anchored
mode regex sees the trailing tag.

## Blast radius

`src/board/markdown.ts` and a harness episode covering a wrapped open question. No board files, no
schema change, no UI, no session or prompt code.

## Acceptance criteria

- [x] `pnpm check` passes with zero errors (command)
- [x] `markdown.ts` runs `CHECKLIST_RE` in exactly one place (file)
- [x] `resolveQuestion` writes its fold line unwrapped, so the fold match holds by construction, and a comment says so (file)
- [x] An episode whose story brief wraps every criterion across two lines moves refining to ready, and the parsed criteria come back with their modes (test)
- [x] The same episode's parsed criterion text is the whole criterion joined with single spaces, tag stripped (test)
- [x] A blank line, a following checklist item, a heading, and an unindented line each end an item rather than folding into it (test)
- [x] An episode resolves an open question whose text wraps across three lines: the story file shows it checked and its answer folded under Approach (test)
- [x] `resolveDecision` and `checkQuestion` share one scanner and one in-place rewrite, neither carrying a line scan of its own (file)
- [ ] `checkReadyGate` accepts 004-04, 004-05 and 005-07 as they sit on disk, unchanged: 004-05 moves refining to ready in the running app without the gate refusing it (live)
- [x] The drawer shows a wrapped criterion as one full line of text, not a truncated one (live)
- [x] Zero console errors on the board and card drawer (live)

## Out of scope

- Rewrapping or reformatting any board file: the parser changes, the files do not.
- An episode for the shaping-decision path. `resolveDecision` reaches the same scanner and the same
  in-place rewrite as `checkQuestion`, but driving it end to end needs a shaping thread whose
  `shape` session resumes, and the stub derives its role from the refine and adversary tool markers
  only (`argv.ts:3`). Teaching it a third role is a harness change, not a parser fix; the path is
  graded by shared implementation and the file criterion above.
- The criterion-matching key the grader uses. Folded text fixes what it matches on; whether it
  should key by index instead is its own question.
- Markdown beyond checklists: nested lists, tables and code blocks inside a checklist item are not
  board format and stay unparsed.

## Open questions

- [x] Does a continuation line need to be indented, or is any non-checklist non-blank line a
      continuation? Indented. An unindented line under a checklist is prose that follows the list,
      and every wrapped item this repo writes is indented under its own bullet.
- [x] Do the mutators rewrite the first line or the whole item? The first line: that is where the
      `[ ]` marker is, and rewriting the fold would reflow text the author wrapped by hand.

## Run notes

- verify: `pnpm check` clean, 127 files, 0 errors; `pnpm build` completes
- verify: `node harness/episode/run.ts all` → 17/17 episodes pass, the two new ones included. The
  four halting episodes were not run; they were not run before this change either.
- verify: live in Chrome against this repo's board, dark theme. The board renders 003-09 at 11
  criteria and 004-05 at 17, both counts taken through the fixed reader; 004-05's Brief tab shows
  every wrapped criterion as one full sentence with its mode tag stripped, including the one whose
  first line ends at "both go through" and whose text now runs on to "`conversation.tsx`". Zero
  console errors across the board and both card drawers.
- `CHECKLIST_RE` is referenced twice, both inside `scanChecklist`: once to open an item and once to
  end one at the next item. One scan site, not one reference.
- The unchecked criterion is half-proven. `checkReadyGate` accepts 004-04, 004-05 and 005-07 as
  they sit on disk, run against the real function; the second half, moving 004-05 to Ready in the
  running app, was not driven, because a story with no verdict starts a real adversary session and
  spends the pool the harness exists to protect. The `wrapped-brief` episode drives that exact walk
  — a wrapped-criteria story from refining to Ready through the real orchestrator and the real
  `checkReadyGate` — at zero cost, which is the stronger evidence. Left for the review decision.
- review: approved at 10/11. The unchecked criterion asked for a walk that costs pool tokens to
  prove and is already proven for free by `wrapped-brief`; it stays unchecked because the walk it
  names was not driven, and the story exits on the evidence that replaces it.
