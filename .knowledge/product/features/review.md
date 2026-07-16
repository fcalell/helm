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

The review surfaces the tests, not only the tally: which test commands ran and their output, and
whether a human verification pass is still needed. A criterion graded from code inspection alone, or
one no automated test covers, is flagged as needing a human check, with the steps to reproduce and
verify it by hand. Automated evidence and the human to-do list sit side by side, so approving is a
decision about what the machine could not prove, not a re-read of the whole diff.

## Two axes: spec and standards

Review answers two independent questions and keeps them apart. The **spec axis** is the self-grade
above: does the diff satisfy the brief's acceptance criteria? The **standards axis** asks the
orthogonal question: does the diff follow the repo's own rules (`CLAUDE.md`, `.claude/rules/`) plus a
baseline of common code smells, whatever the brief said? Each axis runs as its own cold session
([session-kinds](../../architecture/session-kinds.md)) so neither pollutes the other, and the two
verdicts are reported side by side, never blended into one score. A change can meet every criterion
and still violate the repo's conventions, so a single verdict would let one hide the other.

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
