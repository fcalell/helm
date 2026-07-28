---
sessions: {}
---
# Prompt & loop hardening

Shaping thread for the prompt/code/standardization batch out of the 2026-07-28 analysis of the kind
prompts (`src/sessions/kinds.ts`, `prompts.ts`), the loop services (`gate.ts`, `runs.ts`,
`review.ts`, `mcp/tools.ts`), and the agent files. Hand-authored: the conversation happened in a
plain Claude Code session, so no session id is attached.

## Agreed notes

- The batch moves prompt-carried contracts into code where enforcement is deterministic, trims
  restatements of rules the code already enforces, and standardizes prompt composition. Evidence
  frame: `.helm/research/experiments/system-prompts/plan.md` (an explicit rule does not buy
  compliance; shrinking context is what moved contract-edge events) and
  `.helm/research/harness-optimization.md` (deterministic-over-agentic, lever 6).
- Defect-adjacent, fix first: `update_brief.resolves` with an unknown flag title is silently
  dropped (`gate.ts` `gateFixProposed`), so the fix never registers and the flag concedes as
  contested with no counter-argument. `update_brief` gains the same `err()` parity `contest_flag`
  already has, naming the open titles.
- Tool-boundary validation converts gate rounds into instant tool retries: per-section
  refinements on `updateBriefPayloadSchema` (Acceptance criteria and Open questions content must
  parse as `- [ ]` lines), landing malformed proposals as tool errors instead of
  `checkReadyGate` refusals or gate flags.
- Prompt standardization adopts the shared-block decomposition already designed in the
  system-prompts plan (READ_ONLY, BOARD_OUTPUT, GRILLING, VERTICAL_SLICE, TOOL_MECHANICS,
  HEADLESS): `research` stops inlining its own read-only phrasing, HEADLESS leaves RUN_PROMPT for
  reuse by `conflict`, and blocks stay byte-identical across kinds (the prompt-cache rule,
  session-kinds.md §Prompts). A compose helper joins role + body + blocks in fixed order with the
  stopping clause last, making the measured authoring rules structural.
- Trims: `gateFlagsPrompt` shrinks to a pointer plus the flag list (its mechanics paragraph
  duplicates REFINE_PROMPT, which is always present under reseed-on-stale, and the duplicate
  joins the transcript refine re-reads every round); `requestChangesPrompt` stops restating
  RUN_PROMPT's closing contract; consequence clauses of code-enforced rules (the propose_epics
  refusal, the unanswered-flag concession) shrink to one clause; `ask_user`'s end-your-turn
  instruction keeps the tool result as its one home.
- Message-builder collapse: `decisionResolvedPrompt`, `researchResolvedPrompt`, and
  `questionAnswerPrompt` become one builder with a source parameter.
- Commit-convention lint runs at close inside the check-evidence capture (header format and
  length are regex-checkable on the branch's commits); the run prompt keeps one sentence.
- Out of scope: the review registry shape (one row, two prompts) belongs to the review milestone,
  and `propose_scaffold` belongs to the init feature; both stay on the system-prompts plan's open
  items.
- Stop-hook enforcement scope: both checks (a closing `update_card` note this segment, a clean
  worktree), bounded at three refusals like PreCompact.
- Denied-call memory granularity: exact (tool, input) signature match, per segment. Normalized
  matching risks auto-denying a call the user would approve; exact match covers the observed
  failure mode, verbatim retries.
- Per-repo prompt override shape: body-only inside a fixed frame the compose helper owns; a
  whole-prompt replacement stays unavailable.
- CLAUDE.md suppression: measured closed. Every suppression path (`--bare`,
  `CLAUDE_CODE_SIMPLE=1`) disables subscription auth, so the batch drops the item; the standing
  lever is keeping the import chain lean (claude-integration.md §Invocation model).
- The batch also absorbs `loop-findings.md`'s two gate defects (both verified live on current
  code) as a gate-resilience story: same hardening frame, and the doc exists to be triaged. The
  other planned research levers stay out: the warm adversary middle and the scope-lock overlay
  are open experiments, the permanent shape gate is a new loop stage owed its own shaping
  thread, and Fable-out routing waits on an unspiked rate-limit signal.

## Decisions

- [x] **Stop-hook enforcement scope?** Both checks (a missing closing `update_card` note this
  segment, a dirty worktree), bounded at three refusals like PreCompact, so a wedged run can
  still end.
- [x] **Denied-call memory granularity?** Exact (tool, input) signature match, per segment.
  Normalized input (e.g. any `git push` variant) risks auto-denying a call the user would
  approve.
- [x] **Per-repo prompt override shape?** Body-only override inside a fixed frame. The
  system-prompts plan records the risk that a whole-prompt edit reintroducing the skeleton
  raises that kind's draw by half again.
- [x] **Can a headless spawn suppress the CLAUDE.md injection?** Yes, but every path is closed to
  Helm. Measured 2026-07-28 on CLI 2.1.220 via the capture probe: `--bare` (or
  `CLAUDE_CODE_SIMPLE=1` alone) drops the reminder (first message 14,140 → 432 chars on this
  repo), but both restrict auth to `ANTHROPIC_API_KEY`/`apiKeyHelper`; the keychain login and
  `CLAUDE_CODE_OAUTH_TOKEN` are ignored, so suppression forces API billing and violates the
  subscription constraint. No settings key or env var suppresses CLAUDE.md alone (docs checked
  same day). Recorded in claude-integration.md §Invocation model; no story ships from this item,
  and the fallback lever is keeping the import chain lean. (research)
