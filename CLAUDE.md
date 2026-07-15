# Helm

Helm is a self-hosted kanban orchestrator for Claude Code workflows. Epics and stories are shaped in
conversation with Claude, refined into implementation briefs, executed as headless Claude Code runs
in git worktrees, and reviewed against their own acceptance criteria. It wraps the user's locally
authenticated `claude` CLI, so it runs on a Claude Max subscription with no API billing. **UI and
code are English.**

**Pre-product stage.** The spec lives in `.knowledge/`; the only code is the stream-json spike
(`spikes/stream-json/`, throwaway reference scripts). The next milestone is board storage
(`.knowledge/product/roadmap.md`).

@.knowledge/index.md

`.knowledge/` (mapped by the index above) is the source of truth for *what Helm is and why*: product
and architecture. `.claude/playbooks/` holds the how-to-build rules. **Nothing below the index
auto-loads**: the Rules map below says which playbook to read for what you're about to do. Pull a doc
the moment your task matches it; never pre-read the whole base.

## Posture (non-negotiable)

These three override convenience, habit, and effort. Most often broken, hold them hardest.

- **Follow the rule; never lean on the exception.** Every exception in these rules and `.knowledge/`
  is a *closed list of already-decided call sites*, not a menu or permission to add one. Read
  exhaustive lists as exhaustive, and hedge words ("almost", "usually") as the rule still holding.
  Wanting a *new* exception is a STOP signal. Follow the rule, or ask; never self-authorize.
- **Never reduce scope silently.** Dropping, deferring, stubbing, narrowing, or simplifying-away any
  part of the ask is my decision, never yours. If you can't deliver the whole thing, or you're
  tempted to cut a corner, STOP, name exactly what you'd drop and why, get confirmation first.
  Never report partial work as finished.
- **Effort is never a reason to skip the right change.** If something warrants a refactor (the
  change touches it, it's drift, the correct shape is clear), do it or flag it, however much work.
  Never pick the smaller fix *because* the right one is more work; never leave known drift
  unflagged. Effort informs *sequencing*, never *whether*. Not license to abstract speculatively;
  premature abstraction stays forbidden.

## General

- Be concise: least words to describe a concept. A bullet keeps policy + the minimum mechanics to
  apply it; rationale and evidence move to `.knowledge/` or code.
- Be flexible: spot improvement/simplification/abstraction opportunities and implement them. Ask
  first when they diverge from the plans.
- **Least code, simplest shape.** Ship the least, clearest code that fully delivers the ask; prefer
  an explicit solution at the source of truth over clever indirection (wrappers, proxies, magic).
  Two limits: never write less by narrowing scope, and simplest ≠ smallest-diff. The clearest
  design is sometimes the larger refactor.
- Don't rely on (possibly outdated) training data. Check latest docs via context7. When defining a
  convention or library usage, record best practices/gotchas in `.knowledge/`, optimized for LLM
  consumption (minimal words). Claude Code CLI behavior (flags, auth, session format) changes fast:
  re-verify against current docs before building on it.
- Don't document past decisions; docs are a snapshot of current state or future features.
- **Docs are generic, simple, measurable, and lead with a decision workflow.** A boundary is a count
  or a structural fact, not a file path or symbol name. Repo-specific lists (allowlists, registries)
  live in `.knowledge/` as data the rules reference, never inlined into the rule text.
- Prefer tools and harness-native features over raw scripts.
- Work on master branch only.

## Rules: pull the playbook before you act

`.claude/playbooks/` is **pull-only** (not auto-loaded). Before starting an activity below, **read
the listed doc(s)**, don't write in a domain without loading its rules, and read only what the task
needs.

| About to…                                      | Read                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| edit/create any TypeScript                     | `.claude/playbooks/conventions.md` (TS · Biome · naming · comments · errors)                                                    |
| write any prose (docs · KB · commit/PR bodies) | `.claude/playbooks/writing-style.md`                                                                                            |
| edit the knowledge base                        | `.claude/playbooks/knowledge-base.md`                                                                                           |
| commit                                         | **Conventional Commits** (`feat`/`fix`/`chore`/`docs`/`refactor`/`test`); header ≤ ~60 chars; body ~100-wrapped, says the *why* |

## Where things are

- **Today**: `.knowledge/` (product + architecture spec), `.claude/playbooks/` (authoring rules),
  `spikes/` (throwaway reference scripts, one folder per spike).
- **Planned shape** (detail in `.knowledge/architecture/overview.md`): a Node/TypeScript
  orchestrator that spawns headless `claude` sessions and exposes HTTP + WebSocket; a web UI (PWA)
  as its first client; boards stored as markdown under each target repo's `.helm/`. No database.
  Built as a `@fcalell/stack` consumer (SolidJS UI); the stack lives in the sibling `../stack`
  repo and gets improved as Helm needs (`plugin-node`, WebSockets). **No tests in this repo**;
  stack changes follow `../stack`'s own rules.
