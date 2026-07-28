---
sessions: {}
---
# Prompt & loop hardening

## Goal

Prompt-carried contracts move into code where enforcement is deterministic, prompts shed
restatements of rules the code already enforces, and prompt composition becomes structural.
Format mistakes land as instant tool retries instead of gate rounds, the run's closing contract
is checked at stop time instead of exhorted, and every kind prompt is composed from byte-identical
shared blocks in a fixed frame. Evidence frame:
`.helm/research/experiments/system-prompts/plan.md` (an explicit rule does not buy compliance;
shrinking context is what moved contract-edge events) and
`.helm/research/harness-optimization.md` (deterministic-over-agentic, lever 6).

## Breakdown rationale

Eight stories, ordered so the defect-adjacent fixes land first, prompt structure lands before the
trims that build on it, and the independent enforcement slices ride alone:

1. **Brief tool validation** fixes the silent `resolves` drop (a mistyped flag title makes the
   fix vanish and the flag misreport as contested) and adds per-section payload validation, the
   cheapest gate-round eliminator.
2. **Prompt composition** adopts the shared-block decomposition the system-prompts plan designed
   and adds the compose helper that makes the measured authoring rules structural, with the
   body-only override shape built in.
3. **Prompt trims** removes the duplicated and code-enforced text; separate from 2 because the
   trims edit the same files and rebase cleanly only after the structure lands.
4. **Stop-hook close contract** turns the run's closing exhortations into a bounded stop-time
   check.
5. **Denied-call memory** makes denial finality structural in the permission path.
6. **Commit lint at close** adds Conventional Commit evidence to the check capture review reads.
7. **Standing-context trim** is the fallback the research decision left: the CLAUDE.md injection
   cannot be suppressed under subscription auth, so the import chain itself gets the lean pass
   (it grew ~40% since the P1 measurement).
8. **Gate resilience** triages the two live gate defects from `loop-findings.md`: the first run
   note staling the verdict (reproduced on current code) and the mid-flight brief edit silently
   destroying the whole attempt. One story because they share the surface and each is small.

Shaping context and the decisions behind this slicing:
[prompt-loop-hardening](../../shaping/prompt-loop-hardening.md).
