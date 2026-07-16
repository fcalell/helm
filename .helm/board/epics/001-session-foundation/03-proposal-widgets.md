---
id: 001-03
status: ready
depends: [001-02]
gate: { passed: 2026-07-16T21:53:36Z, brief: 9578a10934af0854, overrides: [] }
---
# Drawer chat & proposal widgets

## Goal

The card drawer holds a live chat: the artifact under construction on top, the conversation below,
tool calls as collapsed one-liners, and every proposal rendered as an **accept / edit / reject**
widget (`.knowledge/product/features/define-refine.md`). This is the pure-UI slice over stories
001-01 and 001-02.

## Approach

- Extend `src/app/components/card-drawer.tsx` (or split it) with a chat pane: message composer,
  assistant output rendered incrementally from the `stream_event` deltas 001-01 forwards over the
  WS session channel, tool-call events as collapsed expandable one-liners.
- The chat pane binds to a session id plus its card, never to a kind: it renders whatever
  session the frontmatter (or a dev entry) names. Until 001-04/05 wire the real entries and
  seeds, a dev-only entry spawns a `define` session on the story's epic through the 001-01
  routes — the session whose `propose_stories` calls make the mini-card widgets demoable here.
- A widget component per proposal shape: proposed epics and stories render as mini-cards with
  per-item accept/edit/reject plus accept-all; `ask_user` renders quick-reply chips with a
  free-text fallback. Resolution calls 001-02's per-item endpoint (accepted items write once,
  edit/reject texts batch into one resume); the board updates over the existing board channel,
  no reload.
- Edit opens the proposal payload inline; submitting sends it back as that item's edit outcome,
  resuming the session for a re-proposal — accepting is the only write, per the spec
  (`.knowledge/product/features/define-refine.md` §Proposal widgets).
- The artifact pane is a slot the chat stories fill (Decisions checklist for shape, the brief for
  refine); this story ships the layout and the widget machinery with the shape/define widgets as
  the first concrete case.
- Client state additions in `src/app/lib/` (session events, pending proposals) following the
  existing `board-store.ts` pattern.

## Blast radius

`src/app/` only: `card-drawer.tsx` and new chat/widget components, plus `lib/api.ts` and a session
store in `lib/`. Possibly small additions to `src/shared/channels.ts` types if the UI needs
shapes the server stories did not export.

## Acceptance criteria

- [ ] A message sent from the drawer streams the assistant's reply into the chat pane as it
      generates.
- [ ] A `propose_stories` call renders mini-cards with per-card accept/edit/reject and
      accept-all; accepting lands the cards on the board without a reload.
- [ ] Editing a proposal resumes the session with the edited payload, and the following
      re-proposal reflects the edit.
- [ ] An `ask_user` question renders quick-reply chips plus free text, and answering resumes the
      conversation in place.
- [ ] Tool calls appear as collapsed one-liners that expand on click and never interleave with
      prose as noise.

## Out of scope

- The chat entry points and seeds (`n`, `r`, header shaping entry; 001-04 and 001-05).
- The brief artifact pane content (001-05) and the gating badge (001-06).
- Mobile layout polish (v2, `.knowledge/product/features/mobile.md`).

## Open questions

None.
