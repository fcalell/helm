# Review: graded against the brief, not read cold

Review inverts the usual diff-first flow: **the acceptance-criteria checklist leads, the diff
supports**. The user verifies verdicts instead of reading a cold 400-line diff, which is also what
makes review workable from a phone ([mobile](./mobile.md)).

## Self-grading

When a run finishes, a cheap review session (read-only allowlist plus Bash limited to the repo's
test commands, so evidence can include real test output) grades each acceptance criterion from the
story's brief: **✓ / ✗ / unclear, each with evidence** (file:line references, test or command
output). The tally lands on the card (5/6 ✓). Grades are claims to verify, never
auto-approval; a human decides every exit. (v2; v1 review is the checklist rendered ungraded +
the diff. See [roadmap](../roadmap.md).)

## The review drawer

Diff tab: per-file, side-by-side, with the criteria checklist pinned above; clicking a criterion's
evidence jumps to the lines. Before review opens, the story branch is **rebased on the target's
main**; a conflict spawns an agent-assisted conflict-resolution run rather than dumping conflict
markers on the user.

## Three exits

- **Approve**: re-rebase if main moved since review opened, merge to main and push (or open a PR
  via `gh` in PR mode), delete worktree + branch, card → Done. Merges run one at a time once
  parallel runs land.
- **Request changes**: the user's comments (per-criterion or free-form) become the next message in
  the **same session, same worktree**, so full implementation context is preserved; card → Running.
- **Discard**: worktree + branch deleted, card → Ready, runs history kept. The brief survives; only
  the attempt is thrown away.

Unmet criteria are the native language of "request changes": a ✗ with the user's confirmation is
already a precise, testable instruction for the follow-up run. This closes the loop the product is
built around ([vision](../vision.md) §Wedge).
