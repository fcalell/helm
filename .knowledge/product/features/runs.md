# Runs: autonomous implementation, supervised

A **run** is one headless Claude Code execution of a Ready story. One tap on a Ready card creates a
git worktree + branch (`helm/<epic>-<story>-<slug>`), then spawns the session with the story's
brief as the prompt and the story's permission preset attached. Everything a run needs is in the
brief; a run that has to ask basic scoping questions is a refinement failure, not a run problem.

## Permission presets

Set per story, before the run:

- **Guarded** (default): file edits auto-approved, Bash and anything destructive prompts.
- **Auto**: allowlisted tools run free, nothing prompts.
- **Manual**: everything prompts.

Permission prompts surface as **approve/deny buttons on the card** (and as notifications), never
lost in a terminal.

## Needs input, a first-class state

When the agent hits a genuine decision mid-run, the card flips to Needs input
([board](./board.md)): the question renders as a quick-reply form, a notification goes out
([mobile](./mobile.md)), and the answer resumes the session. A run never sits blocked for hours
because the user left their desk.

## Activity timeline & steering

The drawer's Activity tab streams the run live: assistant narration surfaced, tool calls collapsed
to one-liners, file edits as inline mini-diffs. A steering box injects a user message into the
running session ("stop, use the existing retry queue"); pause and stop are always available.
Interrupting is cheap by design: the session resumes where it left off.

## Queue & rate limits

Runs above the **concurrency cap (default 2)** queue in Ready order. The board header shows a
meter for the Max 5-hour window and weekly budget; the queue **auto-pauses near the ceiling**
instead of burning the user's interactive headroom, and resumes when the window rolls. Rationale:
the rate-limit pool is shared with interactive use
([vision](../vision.md) §The constraint that shapes everything).

## Run lifecycle

A finished run commits its work on the story branch (Conventional Commits), writes its outcome to
the story's frontmatter via the Stop hook, and flips the card to Review
([review](./review.md)). A failed/aborted run parks the card in Blocked with the last error
surfaced. Worktrees live until the story exits Review (merge or discard,
[board-storage](../../architecture/board-storage.md) §Worktrees).
