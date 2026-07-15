# Knowledge base index

The always-loaded **navigation map** for `.knowledge/`: update on any entry add/rename/remove.
Domain docs are read on demand, so a session pulls only the leaf it needs. **Each entry's trailing
text is a load trigger, the work that should make you open that leaf, not a summary of its
contents.** Entries are durable present-tense *what/why* reference, what the code can't tell you
(authoring rules: `.claude/playbooks/knowledge-base.md`).

## Product

- [Vision](./product/vision.md): judging whether an idea fits Helm's scope: the refinement-loop wedge, the Max-subscription constraint, principles, ambition, or a non-goal
- [Roadmap](./product/roadmap.md): scoping v1 vs deferred, checking the Definition of Done, or picking the next milestone
- **Features**: building or changing a feature's behavior; open the matching domain file under [`product/features/`](./product/features/):
  - [board](./product/features/board.md): the kanban board, card anatomy, the status state machine, epics, or the drawer layout
  - [define-refine](./product/features/define-refine.md): the epic/story chat UX, proposal widgets, the brief template, or the ready gate
  - [runs](./product/features/runs.md): implementation runs, permission presets, needs-input, steering, or the queue and rate-limit behavior
  - [review](./product/features/review.md): the review flow, criteria self-grading, or the approve / request-changes / discard exits
  - [mobile](./product/features/mobile.md): the phone surface, PWA install, or notifications

## Architecture

- [overview](./architecture/overview.md): getting your bearings: the orchestrator shape, API-first layering, stack intent, top-level constraints
- [api](./architecture/api.md): adding or changing an orchestrator procedure, the WS protocol, or an API error code
- [claude-integration](./architecture/claude-integration.md): anything touching the `claude` CLI: headless flags, auth, sessions/resume, transcripts, the MCP board tools, or the subscription/ToS constraint
- [board-storage](./architecture/board-storage.md): the `.helm/` on-disk board format, story frontmatter, or the files-as-truth rules
- [deployment](./architecture/deployment.md): hosting on the homelab, network exposure, security posture, or server-side Claude auth
