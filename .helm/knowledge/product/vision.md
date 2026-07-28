# Vision

Helm is a self-hosted kanban board that orchestrates Claude Code. Cards are epics and stories;
conversation with Claude defines and refines them; headless Claude Code runs implement them in git
worktrees; review grades the result against the story's own acceptance criteria.

One-liner: *talk stories into shape, run them autonomously, review against the brief.*

## Wedge: the refinement loop

Existing Claude Code orchestrators (Vibe Kanban, Claude Squad, Crystal) emphasize *executing* tasks
in parallel. Helm's bet is that the value sits upstream: **refinement quality is what makes an
autonomous run work**. The distinctive loop is closed: refine a story into a brief with testable
acceptance criteria → implement against the brief → review self-graded against those same criteria →
unmet criteria feed a follow-up run in the same session. The brief is the contract; everything
downstream is graded against it.

## The constraint that shapes everything: Max subscription, no API

Helm drives the **headless `claude` CLI** (`claude -p`), which authenticates with the user's own
Claude Max login. The Agent SDK requires an API key, and Anthropic prohibits third parties from
offering claude.ai login in their products, so Helm is a **local orchestrator wrapping the user's
own logged-in CLI**, never a hosted service brokering auth. If distributed, every user runs their
own instance against their own installed, authenticated CLI (see
[claude-integration](../architecture/claude-integration.md)).

Max rate limits (5-hour rolling window + weekly caps) are one pool shared with the user's
interactive Claude Code use. Helm therefore designs for **1–3 concurrent runs and a queue**, never
an unbounded fan-out, and shows rate-limit headroom as a first-class UI signal.

## Principles

- **Chat is disposable; the brief is the product.** A conversation never *is* the story: it produces
  a structured artifact (draft cards, a brief section) the user explicitly accepts. Nothing changes
  board state silently from chat.
- **The board is a view over files.** Stories are markdown in the target repo: git-versioned,
  hand-editable, and readable/writable by the agent itself. No database to sync.
- **Supervision over spectation.** The user shouldn't have to watch runs. Blocking moments (a
  question, a finished run) come to them as interrupts, answerable from a phone.
- **Every artifact comes from a template.** Nothing Helm generates starts from a blank page:
  briefs, cards, reports, and scaffolded config are stamped from templates that encode the current
  best practice. Predictability is the point, and a template improves over time, so a better
  template lifts every future artifact at once ([templates](../architecture/templates.md)).

## Ambition

**Personal-first, shareable later.** Built for the author's homelab and repos; real dogfood before
polish. Kept clean enough to open-source. Anthropic's legal page permits personal headless CLI use
but bars third-party orchestrators from routing Max credentials, so a public release ships API-key
auth as its distribution mode
([claude-integration](../architecture/claude-integration.md) §Why the CLI, not the Agent SDK).
Distribution is a global CLI install (`helm` inside a repo serves that repo), never a per-repo
dependency ([overview](../architecture/overview.md) §Shape).

## Non-goals (v1)

- **Not a hosted SaaS.** Single-user, self-hosted; no multi-tenancy, no account system beyond one
  UI session secret.
- **Not an IDE.** Helm never edits code by hand; humans steer, agents type. Deep code browsing
  belongs in the editor.
- **Not a general agent platform.** Claude Code is the only backend; no provider abstraction layer.
- **Not a project-management suite.** No estimates in points, sprints, burndowns, or multi-user
  assignment; the board exists to feed and supervise agent runs.
