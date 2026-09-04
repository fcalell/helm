# UX feedback

First-use notes to focus on later. Each item is an observed friction, not yet a shaped fix.

## Entry points

- **New epic vs shape should be one entry point.** Shaping decides whether the work becomes one
  epic or several; the user shouldn't pre-commit to "epic" before that conversation happens.

## Shape chat — menu

- **Recoverable chats are mixed in with other menu options.** From the menu it's not clear which
  entries are past chats to resume vs. plain actions. Separate/label them.
- **No way to fullscreen or enlarge the chat window.** Add at least an enlarge affordance.

## Chat — human-feedback requests

- **Request for feedback is visually unclear.** The prompt asking the human to answer doesn't read
  as a distinct, actionable element.
- **Options overflow the container when long.** Long option labels break the layout.
- **Multiple feedback boxes render sequentially.** When several requests are pending they stack and
  are hard to work through — group them.
- **Assistant re-loads after each answer.** Answering one request triggers an assistant load before
  the next. Batch all answers (or present one at a time cleanly) instead of loading between each.

## Live inspection — self-grading shaping chat (2026-07-22)

Bugs confirmed in-browser (Chrome), recovered shaping drawer:

- **No conversation transcript renders.** The whole drawer DOM is: Decisions panel → a single
  Question widget → composer. None of the prior assistant/user turns or the earlier
  Accept/Edit/Reject decision cards are present — you cannot scroll back through the conversation.
  On recover, only the live structured widgets rehydrate; the message history is lost/not rendered.
  Worse: a reloaded tab reconstructs a *stale* widget — it showed the old `ask_user` question, not
  the pending epic proposal (`31c915c5`) the session had already produced — so the drawer misrepresents
  where the session actually is, making a moved-on session look stuck.
- **Answer → check-off gap (blocking).** ask_user answers don't check off the Decisions items — all
  four stay `- [ ]` in the thread file, so `propose_epics` stays refused. The turn-based Q&A answers
  aren't written back to decision state. The assistant is now asking the human to hand-edit the file
  to unblock. (Root cause of the loop stalling.)
- **Two out-of-sync sources of truth for decision state.** Verified against the shape session
  transcript (`8668e4f3`): `propose_epics` refused while decisions were open, then *succeeded* once
  they were resolved via the widgets — but the thread-file checkboxes were **never written**, still
  `- [ ]` on all four *after* the proposal was recorded. The gate keys off in-service decision
  state; the file `[x]` is written by a separate path that isn't firing. Files-are-truth
  (board-storage) is violated: disk and gate disagree.
- **`raise_decision` + `ask_user` are duplicated.** The assistant raised 4 decisions, then asked
  each again verbatim via `ask_user` (≈8 rounds for 4 decisions). Answering the `ask_user` copy
  resolves nothing, so the two mechanisms fight — this is the sequential-boxes pain, root-caused.
- **Two competing input boxes.** The Question widget has its own answer form
  ("Or answer in your own words… / Send") while the drawer also has the main composer
  ("Message the chat… / Send"). Two Send targets, unclear which advances the decision vs. chats.
- **Superseded `ask_user` questions stay rendered as active input forms.** The "paste the four
  checked lines" question still renders with a live answer box at the very bottom of the drawer —
  *below* the newer PROPOSED EPICS widget (which has working Accept/Edit/Reject). The newest
  actionable widget sits above stale ones, so the bottom of the drawer — where the eye and cursor
  land — is a dead-end question demanding work that's already done. This is the "can't proceed even
  interacting with the widgets" trap: the proposal's Accept button exists but is scrolled above the
  stale question. Retire/disable a question widget once it's superseded, and keep the active widget last.
- **Quick-reply chip overflows (confirmed live).** The recommended-answer button's label is the
  entire recommendation sentence; it overflows the container horizontally (right edge clipped).

## Decisions panel

- **"DECISIONS" panel says "No decisions raised yet" while DECISION cards render below in the chat
  flow.** The approvable decision cards (Accept / Edit / Reject) appear inline in the transcript,
  disconnected from the dedicated decisions panel — which stays empty. The panel and the inline
  cards should be the same source of truth: surface pending decisions in the panel (or drop the
  panel and keep them inline), not both, out of sync.
