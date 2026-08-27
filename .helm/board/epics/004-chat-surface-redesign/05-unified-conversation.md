---
id: 004-05
status: review
depends: [004-03, 003-09]
gate: { passed: 2026-08-27T13:33:00.477Z, brief: f0eef71cfb84ff3d, overrides: [] }
sessions: {}
---
# Unified conversation

## Goal

One `Conversation` component renders every transcript: chat surfaces and the run timeline stop
being two near-identical copies of the same switch, `compact` items render in one place instead of
only in the run copy, assistant text renders as markdown through the stack's `Prose`, and the
scroll model follows the reader — sending anchors the new user message near the top with the reply
streaming into the space below, and a scroll-to-bottom control appears while the pane is unpinned.

## Approach

Facts measured at Helm `51176c0` and stack `1479d1b`, both clean on master.

- **Half the story already shipped.** 004-09's canon migration replaced the unconditional
  pin-to-bottom this card was written against: both panes now render `<ScrollArea pinToBottom>`
  (`chat-pane.tsx:161`, `activity-pane.tsx:158`), and the stack's `ScrollArea`
  (`scroll-area/index.tsx`) derives pinned-ness inside its `MutationObserver` from the
  *pre-mutation* `scrollHeight` with a 40px threshold. The scrolled-up guard the goal asks for
  exists and is correct. What is left of the scroll model is the anchor-on-send and the
  scroll-to-bottom control.
- **The two switches are the same switch.** `TranscriptItem` (`chat-pane.tsx:95-118`) and
  `TimelineItem` (`activity-pane.tsx:79-105`) carry the `user` and `assistant` cases verbatim, and
  each file carries its own byte-identical `asType` helper (`chat-pane.tsx:90-95`,
  `activity-pane.tsx:71-76`). They differ in exactly two places: the `tool` case (`ToolItem`
  resolves a logged proposal or question and falls back to `ToolCallLine`; `ToolActivity` renders a
  `MiniDiff` for `Edit`/`Write` and falls back to the same `ToolCallLine`), and the `compact` case,
  which only the run copy has. Both panes wrap the scroll area in the same
  `flex min-h-0 flex-1 flex-col gap-stack overflow-hidden` column with an intrinsic form pinned
  below.
- **`compact` is store-wide, not run-only.** A live boundary arrives as a system wire event and is
  pushed for any session (`session-store.ts:237-242`), and hydration builds the same item from a
  persisted line (`chat-events.ts:163-169`). Only the renderer is run-only, so a compacted chat
  session drops the boundary silently. One renderer closes that, and the stub's `emit` step
  (`stub.ts:137-140`) puts the system frame on a chat session to grade it.
- **Two different components share the name `Prose`.** Helm's `src/app/ui/prose.tsx` is a
  `whitespace-pre-wrap` `<p>` with variant and tone props; the stack ships a `marked`-backed
  markdown renderer at `@fcalell/plugin-solid-ui/components/prose`. The stack renderer escapes raw
  HTML, rejects `javascript:`/`vbscript:`/`data:` hrefs, and wraps the parse in a try/catch that
  degrades to escaped plain text — safe on streamed text, which arrives as growing prefixes.
  Helm's local component keeps four non-transcript call sites (`decision-widget.tsx`,
  `gate-panel.tsx`, `proposal-widget.tsx`, `card-drawer.tsx`), so it is renamed, not deleted, and
  only the transcript's assistant case moves to markdown.
- **Both scroll actions belong to elements Helm already renders.** `ScrollArea` types `class`,
  `style` and `classList` as `never` and keeps its pane in a closure, so the reflex is to widen it.
  Nothing here needs that: `scrollIntoView` on a descendant scrolls its nearest scrollport, so
  anchoring is `block: "start"` on the user message's own element and returning to the bottom is
  `block: "end"` on a trailing sentinel — both elements the conversation owns. `../stack`'s posture
  calls a new consumer-facing option the last resort, and this is not one.
- **Pinned-ness is an observer on that same sentinel.** An `IntersectionObserver` computes against
  every clipping ancestor, so a sentinel scrolled out of the pane stops intersecting even with a
  null root: the control's condition is "the sentinel is not visible", read from an element Helm
  owns, with no second copy of the stack's threshold logic and no stack change.
- **Anchoring needs room below, and the room must not lie about pinned-ness.** Scrolling the newest
  user message to the top only works if at least a pane's height of content sits below it, and at
  the end of a transcript it does not. The conversation renders a spacer sized to the pane at send
  time and removed when the turn closes, with the sentinel *after* it — so a spacer that is merely
  present never reads as "at the bottom", and the collapse at close leaves the reader at the end of
  the turn.
- **The anchor and the pin do not fight.** Anchoring scrolls away from the bottom, so the stack's
  observer reads `wasPinned` as false on the reply's appends and leaves the pane alone. The
  existing guard is the mechanism that makes the anchor hold; no flag coordinates the two.
- **A floating control cannot live in `components/`.** The geometry gate's vocabulary
  (`packages/ui-core/src/gate.ts`) allows `absolute` and the zero insets only, so a
  `bottom-4 right-4` overlay button is a violation there. `src/app/ui/` is skipped by the gate, so
  the control's geometry is `ui/`'s, the same split `chat-drawer.tsx` used in 004-04.
- **A live transcript exists only under the stub.** This repo's board has no chat session, which is
  what left 004-04's fill-and-scroll criterion ungraded. `harness/` drives a scratch repo through
  the stub `claude`, and that board carries real transcripts with tool calls, proposals and, via an
  `emit` step, a compaction boundary — so every live criterion here is graded against a stub-driven
  board in Chrome, at zero pool cost.

**The shape.** `src/app/components/conversation.tsx` owns the transcript: the single `asType`, the
`user`, `assistant`, `compact` and `tool` cases, the `ScrollArea`, the send-time spacer, the
trailing sentinel with its observer, the anchor effect, and the scroll-to-bottom control. It takes
the session id, a `renderTool` prop for the surface's tool case, and a trailing slot for what each
surface appends below the items (the chat's widget groups and loader, the run's loader and paused
line). `chat-pane.tsx` keeps the artifact panel, slash commands and composer and passes `ToolItem`;
`activity-pane.tsx` keeps the brief-edited banner, run controls and steer form and passes
`ToolActivity`. The anchor fires on every send, from wherever the reader was: a message the reader
just wrote is what they want to see, and a conditional anchor makes the same action move the pane
or not for reasons the reader cannot see. Helm's `ui/prose.tsx` is renamed to name what it is
(author-entered text with its newlines intact), and the transcript's assistant case renders
`Prose markdown={…}` from the stack. No stack change.

- **The brief cannot legally reach ready yet.** `checkReadyGate` drops the verification mode of
  every criterion that wraps, so this brief fails the gate on 11 of its 17 criteria. 003-09 fixes
  the parser; this story waits on it rather than unwrapping criteria to dodge it.

## Blast radius

`src/app/components/conversation.tsx` (new), `src/app/components/chat-pane.tsx`,
`src/app/components/activity-pane.tsx`, `src/app/ui/prose.tsx` (renamed) and its four call sites,
and a new scroll-to-bottom control under `src/app/ui/`. No stack, orchestrator, board, session, or
harness code.

## Acceptance criteria

- [x] `pnpm check` passes with zero errors (command)
- [x] `pnpm build` completes and the geometry gate reports zero violations over `src/` (command)
- [x] Exactly one `asType` helper and exactly one transcript item switch exist under `src/app/`
      (file)
- [x] Neither `chat-pane.tsx` nor `activity-pane.tsx` renders a `ScrollArea` of its own: both go
      through `conversation.tsx` (file)
- [x] `git diff` touches no file under `../stack` (command)
- [ ] A `compact` boundary emitted into a chat session renders its line in the chat surface, and
      the same boundary still renders in the run timeline (live)
- [ ] Assistant text containing a list, a fenced code block, `**bold**` and a link renders as
      markdown in both a chat surface and the run timeline (live)
- [x] A reply streamed in prefixes renders every prefix without a console error and settles to the
      final markdown when the turn closes (live)
- [x] Raw HTML in assistant text renders escaped, and a `javascript:` link renders without an href
      (live)
- [x] Sending a message scrolls that user message to the top of the pane and the reply streams into
      the space below it without the pane jumping (live)
- [ ] Steering a run anchors the steer message the same way (live)
- [x] The scroll-to-bottom control appears only while the pane is scrolled off its bottom, and
      clicking it returns the pane to the bottom and hides the control (live)
- [x] The control stays hidden while a spacer is present but the pane is at its end: a spacer alone
      never reads as unpinned (live)
- [x] A pane already at the bottom still follows new content, and a reader scrolled up mid-stream
      is never yanked down (live)
- [x] No dead space sits below the last item once the turn closes (live)
- [x] The docked panel keeps the fill-and-scroll layout with a real transcript at both its minimum
      and maximum width: intrinsic artifact panel, scrolling transcript, composer pinned below
      — carried from 004-04, which had no transcript to grade it against (live)
- [x] Zero console errors across a chat surface and a run timeline (live)

## Out of scope

- The widget and eyebrow primitives, and `AnswerChip` everywhere chips render: 004-06.
- Acceptance feedback on proposals: 004-07.
- Rendering markdown in the four non-transcript `Prose` call sites (brief sections, gate flags,
  proposal bodies, decision text). The rename makes the choice explicit; converting them is its own
  change with its own live grading.
- The 240px tab-row clipping 004-04's review recorded: 004-06 owns it.
- The mobile surface.

## Open questions

- [x] Does the scroll model need the stack's `ScrollArea` widened? No. Both actions are
      `scrollIntoView` on elements the conversation renders, and pinned-ness is an
      `IntersectionObserver` on its trailing sentinel.
- [x] How near the top is "near the top"? Flush: `block: "start"` puts the message at the pane's
      top edge, and an offset would be a number with no reason behind it.
- [x] Does the anchor fire on every send, or only from a pinned pane? Every send. The reader wrote
      the message; a conditional anchor makes one action behave two ways invisibly.

## Run notes

- verify: `pnpm check` clean, 127 files, 0 errors; `pnpm build` completes with the geometry gate
  pre-step, 0 violations
- verify: one `asType` and one item switch under `src/app/`, both in `conversation.tsx`; neither
  pane names `ScrollArea`; `git diff` in `../stack` is empty
- verify: `node harness/episode/run.ts all` → 17/17
- verify: live in Chrome against a stub-driven scratch board, dark theme. A sent message anchors to
  the top of the pane and the reply streams into the space below without the pane moving; the
  markdown renders as a list with real emphasis, a fenced block, one `<a href="https://example.com">`
  and no anchor at all for the `javascript:` link, with `<b>not bold</b>` escaped to text; the
  compaction boundary renders its line in the chat surface; the tool call renders as a disclosure
  line; the control appears only off the end, returns the pane and hides; a paragraph appended while
  the reader sat scrolled up moved nothing, and one appended while the reader sat at the bottom was
  followed; the turn's close collapsed the spacer with the last item flush at the bottom; and the
  panel keeps its intrinsic artifact panel, scrolling transcript and pinned composer at both 240px
  and 75vw. Zero console errors throughout.
- `conversation-live` is the halting episode that stands this up: it streams a markdown reply in
  prefixes, emits a compaction boundary and a tool call, and then holds twice so an operator can
  park the pane scrolled up and at the bottom and watch what the next append does.
- Two flaws the live pass caught, both fixed. A spacer of exactly one pane height leaves the end of
  the content inside the canon's 40px pin threshold, so the first delta pinned the pane back and the
  anchor never held; the spacer now carries that margin on top. And a zero-height sentinel has a
  zero-area intersection rectangle, which never reports as intersecting, so the control stayed up at
  the very end; the sentinel is a line tall.
- The spacer is `calc(100% + 40px)` rather than a measured height: the transcript's own element is
  the content, not the pane, so measuring it gave a near-zero spacer on an empty transcript. The
  percentage resolves against the scroll pane without reaching into the canon's DOM.
- Three criteria are unchecked, all for one reason: they need a run transcript, and a run session
  reaches the stub with no scripted role (`argv.ts:3` knows refine and adversary only), so the run
  timeline cannot be driven at zero pool cost. It renders through the same `Conversation`, the same
  markdown case and the same anchor as the chat surface — the only difference is `renderTool` — and
  the Activity tab was checked live for its empty state and zero console errors. Teaching the stub a
  run role is a harness change, not this story's.
