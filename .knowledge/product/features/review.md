# Review: graded against the brief, not read cold

Review inverts the usual diff-first flow: **the acceptance-criteria checklist leads, the diff
supports**. The user verifies verdicts instead of reading a cold 400-line diff, which is also what
makes review workable from a phone ([mobile](./mobile.md)).

## Self-grading

When a run finishes, a cheap review session (read-only allowlist plus Bash limited to the repo's
test commands, so evidence can include real test output) grades each acceptance criterion from the
run's brief snapshot ([runs](./runs.md)): **✓ / ✗ / unclear, each with evidence** (file:line
references, test or command output). The tally lands on the run's frontmatter entry and shows on
the card (5/6 ✓). Grades are claims to verify, never auto-approval; a human decides every exit.
(v2; v1 review is the checklist rendered ungraded + the diff. See [roadmap](../roadmap.md).)

The checkbox follows the evidence. A criterion the session proves with a test it ran is checked on
the spot; one graded from code inspection alone, or covered by no automated test, stays unchecked
and flagged as needing a human check, with the steps to reproduce and verify it by hand
([board-storage](../../architecture/board-storage.md) §Story file). The review surfaces which test
commands ran and their output, so checked boxes carry proof and unchecked ones are the human
to-do list: approving is a decision about what the machine could not prove, not a re-read of the
whole diff.

## Two axes: spec and standards

Review answers two independent questions and keeps them apart. The **spec axis** is the self-grade
above: does the diff satisfy the brief's acceptance criteria? The **standards axis** asks the
orthogonal question: does the diff follow the repo's own rules (its root `CLAUDE.md` and the rules
Helm keeps under `.helm/agents/`) plus a baseline of common code smells, whatever the brief said? Each axis runs as its own cold session
([session-kinds](../../architecture/session-kinds.md)) so neither pollutes the other, and the two
verdicts are reported side by side, never blended into one score. A change can meet every criterion
and still violate the repo's conventions, so a single verdict would let one hide the other.
Standards findings gate the exit the way the adversary gates Ready: each renders as a widget and
is either accepted, joining the request-changes comments for the follow-up run, or dismissed with
a recorded reason, and approve enables only when none stands unaddressed. Every Helm gate blocks
by default with a deliberate override.

Diff tab: per-file, side-by-side, with the criteria checklist pinned above; clicking a criterion's
evidence jumps to the lines. Before review opens, the story branch is **rebased on the target's
main**; a conflict spawns an agent-assisted conflict-resolution session rather than dumping
conflict markers on the user. The card stays in Review behind a rebasing indicator while the
`conflict` session runs through the queue; a resolved rebase refreshes the diff, so the human
review that follows already covers the resolution, and a failed one parks the card in Blocked
with the error ([board](./board.md) §Status state machine).

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
