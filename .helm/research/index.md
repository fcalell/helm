# Research index

The navigation map for `.helm/research/`: update on any entry add/rename/remove. Research is
**working evidence**, the tier `.helm/knowledge/` excludes: dated measurements, experiment plans,
and findings not yet settled. Nothing here auto-loads. **Each entry's trailing text is a load
trigger, the work that should make you open it.**

Two rules govern the tier. **Conclusions get promoted**: once a finding settles, fold it into the
`.helm/knowledge/` entry it governs and leave the research doc as the evidence behind it. **Drained
docs get deleted**: a triage list with nothing left to triage is git history, not a file.

## Frame

- [harness-optimization](./harness-optimization.md): deciding any model, loop, or automation change: what the harness optimizes and which lever moves it
- [model-matrix](./model-matrix.md): picking or challenging a session kind's model and effort; the measured evidence behind the pairings in `.helm/knowledge/architecture/session-kinds.md`
- [usage](./usage.md): checking what a loop actually drew from the pool, or comparing a story's cost against earlier ones

## Open

- [loop-findings](./loop-findings.md): triaging defects the dogfood loop surfaced into stories; delete once drained

## Experiments

One folder per experiment: the plan, plus the ledgers of the sessions it spent.

- [001-02-board-tools](./experiments/001-02-board-tools/plan.md): the in-process MCP server and proposal plumbing, with its Fable planning and Opus build ledgers
- [system-prompts](./experiments/system-prompts/plan.md): replacing Claude Code's default system prompt with a Helm-authored one per session kind

## Data

`transcripts/` holds raw session `.jsonl`, gitignored: it is reproducible from
`~/.claude/projects/` and the ledgers above are its distilled form.
