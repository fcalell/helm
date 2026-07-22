# Loop hardening: precision into code

Direction agreed 2026-07-22, after the first shaping dogfood surfaced blocking bugs
(`ux-feedback.md`) that the loop graded 5/5. The loop verifies conformance to the brief; no stage
verifies the product works when used. The fix is structural: move orchestration precision from
prompt trust into orchestrator code, and make the loop carry every step of software development
with enforced criteria quality, testing strategy, and typed I/O. To triage into shaping; overlaps
the graded-review proposal (`31c915c5`).

## Why the loop missed the shaping bugs

- **Criteria graded the observable effect, not the on-disk truth.** 001-04's criterion "resolving
  the last decision unlocks `propose_epics`" passed while the file checkboxes were never written.
  Behavior promised only in Approach prose is outside the review contract.
- **Review is static; the bugs are dynamic.** Review grades from code inspection and test output;
  the repo has no tests and no stage drives the running UI. Rehydration, stale widgets, and
  overflow are only observable live.
- **Review is per-story; the desync lives between stories.** The gate state (001-04), the widgets
  (001-03), and the fold-back write (001-07) each graded fine inside their own blast radius. No
  pass owns the seams.
- **Session-prompt behavior is emergent.** The `raise_decision` + `ask_user` duplication is how the
  shape prompt behaves over real turns, invisible until dogfooding.

## Direction: enforce in code, not in prompts

- **Typed result schemas per session kind.** Review returns graded criteria as structured output,
  adversary returns a findings list, run returns per-criterion evidence. The orchestrator validates
  the shape and retries on mismatch instead of parsing prose and trusting it.
- **Criterion taxonomy at the ready gate.** Every acceptance criterion carries a verification mode:
  automated test, command, file read, or live scenario. The gate refuses Ready while any criterion
  lacks one. UI-touching stories need at least one live-scenario criterion; state with a disk
  representation needs a file-read criterion (files-are-truth, checked as a literal orchestrator
  read, not LLM judgment).
- **Deterministic checks run by the orchestrator.** Check commands execute in code and their output
  is handed to the grader as evidence; the grader judges, it never decides what ran.
- **Live-UI review step.** UI-touching stories get a browser-driving pass alongside the spec and
  standards axes, the only modality that catches rehydration and stale-widget bugs.
- **Cross-story integration pass at epic close.** A pass over the epic's combined surface, owning
  the seams no single story's checklist covers.
- **Measured prompt and I/O optimization.** Runs already record tokens, minutes, and grades;
  version the kind prompts and compare rounds-to-converge and grade accuracy across versions, so
  prompt changes are tested like code.
