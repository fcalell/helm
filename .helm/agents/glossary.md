# Glossary

Helm's ubiquitous language. Docs, prompts, UI copy, and identifiers use these exact terms; a forced
synonym ("the ticket", "the task") is a defect. Terms only, no mechanics: the how lives in
`.helm/knowledge/`.

## Board

- **Epic**: a group of stories with one goal. Owns a directory and an `epic.md`.
- **Story**: one unit of work, one file, one card. The smallest thing a run implements.
- **Ordinal**: the `<epic>-<story>` number pair (`012-01`) identifying a story forever. Slugs
  rename, ordinals never do, and a deleted one is retired rather than reused.
- **Shaping thread**: a roadmap-level conversation that produces epics. A source of cards, not a
  card itself.
- **Status**: the card's column, one of backlog, refining, ready, running, needs-input, review,
  done, blocked.

## Refinement

- **Brief**: the story body a run implements: goal, approach, blast radius, acceptance criteria,
  out of scope, open questions.
- **Acceptance criterion**: one checkable statement a run is graded against. Checked means verified.
- **Open question**: an unresolved point holding a story back. Checked means resolved.
- **Ready gate**: the adversary pass a brief clears before it can run.
- **Flag**: a risk the adversary raises against a brief. Dismissing one records an override.
- **Decision**: a feature-level question a shaping thread waits on, tagged human or research.
- **Proposal widget**: the accept/edit/reject control, the only path from chat to a board file.

## Execution

- **Session kind**: the closed set of loop stages (init, shape, research, define, refine,
  adversary, run, review, conflict). A kind fixes the prompt, tools, model, effort, and context
  policy for its stage.
- **Run**: one implement session on a story, plus the follow-ups that extend it.
- **Segment**: one CLI process inside a run. A needs-input round trip splits a run into segments.
- **Preset**: a run's permission mode, one of Guarded, Auto, Manual.
- **Needs input**: a run parked on `ask_user`, waiting for the user.
- **Steering**: a message sent into a live run.
- **Worktree**: the disposable checkout a run works in. The story branch is the durable artifact.
- **Board tools**: the MCP tools a session mutates through (`update_card`, `ask_user`). Chat never
  writes board files.

## Review

- **Self-grading**: the review session checking only the criteria it proved with automated
  evidence; the human checks the rest.
- **Approve · request changes · discard**: the three review exits.
- **Check command**: the repo's single test/lint command that runs and reviews execute.

## Platform

- **Managed repo**: a repo Helm orchestrates.
- **Main checkout**: the repo's server-side working copy, where the board lives and merges land.
- **Pool**: a rate-limit bucket on the Max subscription. A pool-out halts that pool's kinds.
- **Standing context**: the tokens every session loads before any work starts.
