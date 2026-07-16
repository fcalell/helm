# Runs: autonomous implementation, supervised

A **run** is one headless Claude Code execution of a Ready story. One tap on a Ready card creates a
git worktree + branch (`helm/<epic>-<story>-<slug>`), then spawns the session with the story's
brief as the prompt and the story's permission preset attached. Everything a run needs is in the
brief; a run that has to ask basic scoping questions is a refinement failure, not a run problem.

The brief is **snapshotted at spawn**: the run entry records the brief-body hash
([board-storage](../../architecture/board-storage.md) §Story file), compaction reseeds from the
snapshot ([claude-integration](../../architecture/claude-integration.md) §Context management), and
review grades against it ([review](./review.md) §Self-grading). Editing the brief mid-run stays
legal, but it surfaces as a notice and takes effect on the next attempt; steering is the way to
redirect a live run (§Activity timeline & steering).

## Permission presets

Set per story, before the run:

- **Guarded** (default): file edits auto-approved, Bash and anything destructive prompts.
- **Auto**: allowlisted tools run free, nothing prompts.
- **Manual**: everything prompts.

The Auto allowlist is data: Helm ships the canonical list (file edits, the repo's test/lint/build
commands, read-only git) and a repo overrides or extends it under `.helm/`, the same
shared-with-local-override model templates use ([templates](../../architecture/templates.md)).
Init proposes the repo's own test commands into it ([init](./init.md)), and the review kind's
test-command Bash reads the same per-repo list
([session-kinds](../../architecture/session-kinds.md)).

Permission prompts surface as **approve/deny buttons on the card** (and as notifications), never
lost in a terminal.

## Needs input, a first-class state

When the agent hits a genuine decision mid-run, it calls the `ask_user` board tool and ends its
turn ([claude-integration](../../architecture/claude-integration.md) §Board tools); the card flips
to Needs input ([board](./board.md)), the question renders as a quick-reply form, a notification
goes out ([mobile](./mobile.md)), and the answer resumes the session. The pending question is what
distinguishes a stuck run from a finished one when the process exits. A run never sits blocked for
hours because the user left their desk.

## Activity timeline & steering

The drawer's Activity tab streams the run live: assistant narration surfaced, tool calls collapsed
to one-liners, file edits as inline mini-diffs. A steering box injects a user message into the
running session ("stop, use the existing retry queue"); pause and stop are always available.
Interrupting is cheap by design: a headless process accepts no mid-run input, so the orchestrator
kills it and resumes the session with the steering message, and the session picks up where it left
off. The steering message always states that the previous action was interrupted: the resumed
model believes an interrupted tool call never ran, while its side effects may have partially
landed ([claude-integration](../../architecture/claude-integration.md) §Invocation model).

## Queue & rate limits

Runs above the **concurrency cap** (1 in v1, default 2 once parallel runs land) queue in Ready
order. The board header shows a meter for the Max 5-hour window and weekly budget; the window's
reset clock comes from the `rate_limit_event` every session emits, while the token side is a
lower-bound estimate, since no API reports headroom and interactive use on other machines is
invisible ([claude-integration](../../architecture/claude-integration.md) §Rate limits). Limit
errors are the authoritative signal: the queue **auto-pauses** on one instead of burning the
user's interactive headroom, and resumes when the window rolls. A run interrupted by a rate limit
pauses rather than fails: its card stays Running and the session auto-resumes with the queue.
Rationale: the rate-limit pool is shared with interactive use
([vision](../vision.md) §The constraint that shapes everything).

Interactive chat turns bypass the queue: a human never waits behind a run. Every other kind
(`research`, `adversary`, `review`, `conflict`) dispatches through it with the runs
([session-kinds](../../architecture/session-kinds.md)). An auto-pause also disables chat sends
and shows the reset clock, since a send during a limit only burns a failing request.

## Run lifecycle

A finished run commits its work on the story branch (Conventional Commits), reports its outcome
through the Stop hook backstop ([claude-integration](../../architecture/claude-integration.md)
§Hooks), and flips the card to Review ([review](./review.md)). A failed/aborted run parks the card
in Blocked with the last error surfaced; rate-limit interruptions pause instead (§Queue & rate
limits). Worktrees live until the story exits Review (merge or discard,
[board-storage](../../architecture/board-storage.md) §Worktrees).
