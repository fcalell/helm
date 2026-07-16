# Define & refine: chat that produces artifacts

The governing rule: **chat is disposable; the brief is the product.** Every conversation produces a
visible structured artifact (draft cards, a brief section) the user explicitly accepts; nothing
changes board state silently from chat. The drawer therefore always shows the artifact under
construction on top and the chat below it: the user watches the brief fill in while talking and
never needs to reread the transcript.

Both chat kinds are real Claude Code sessions in the target repo, resumed by ID per user message,
with a **read-only tool allowlist** (Read/Grep/Glob + the board tools, no Edit/Bash): safe, fast,
and cheap against the shared rate-limit pool
([claude-integration](../../architecture/claude-integration.md)). Session IDs live in card
frontmatter, so a conversation survives restarts and weeks of pause; the server raises
`cleanupPeriodDays` (Claude Code deletes idle transcripts after ~30 days), and a resume that fails
anyway starts a fresh session seeded from the card
([claude-integration](../../architecture/claude-integration.md) §Invocation model).

## Proposal widgets

Structure comes from tools, not from parsing prose. Chat sessions get an in-process MCP server with
board tools that vary by session kind (`propose_epics`, `propose_stories`, `update_brief`,
`resolve_question`, `flag_risk`, [session-kinds](../../architecture/session-kinds.md)); the UI
renders each tool call as a widget with **accept / edit / reject**. Accepting is what writes the
file; an edit or a rejection with a reason goes back as the next resumed message. Claude never
free-writes board files during chat.

## Grilling

Every chat kind interviews the same way. Questions arrive one at a time in dependency order, never a
bulk list: an early answer reshapes which questions follow, and a firehose loses that structure. Each
question carries Claude's own recommended answer, so the user confirms or redirects instead of
starting from a blank. Anything the code can settle, Claude settles by reading it rather than asking.
The chat holds off proposing until the shared understanding is confirmed. This is the discipline the
`ask_user` primitive enforces ([session-kinds](../../architecture/session-kinds.md) §Interaction).

## Shaping the roadmap

Shaping is the conversation upstream of the board: a feature or a slice of the roadmap talked into
epics before any card exists. Entry is a board-level chat (not attached to a card), reached from the
header, seeded with a rough goal. Claude reads the repo and the current board, then the two of you
argue scope until it holds together. `propose_epics` renders each proposed epic as a mini-card with
per-epic accept/edit/reject; accepting writes a new epic folder
([board-storage](../../architecture/board-storage.md)), and a shaping proposal can carry draft
stories so one agreement lands a whole epic with its first cards. The shaping thread persists under
`.helm/shaping/` and resumes with full memory, so a roadmap conversation survives across sessions
([session-kinds](../../architecture/session-kinds.md)).

## Defining an epic

Entry: `n` → title + a rough paragraph, as messy as the user likes.

1. **Explore first, ask second.** Claude's opening move is reading the actual code, so its
   clarifying questions are informed ones, asked one at a time (§Grilling) as tappable quick-reply
   chips plus free text.
2. **Breakdown arrives as draft cards.** `propose_stories` renders each proposed story as a
   mini-card (title, one-line goal, dependency hints) with per-card accept/edit/reject and
   accept-all. Each story is a vertical slice: a thin path through every layer (schema, API, UI,
   tests) that is demoable on its own, not a horizontal slice of one layer that does nothing until
   the others land. A text reply ("merge 2 and 3, drop 4") triggers a re-proposal.
3. Accepted cards land in Backlog. The chat stays attached to the epic and resumes with full memory
   whenever reopened.

## Refining a story

Entry: open a Backlog card, `r`. The session is seeded with the epic conversation's conclusions,
the card, and the brief template (goal · approach · acceptance criteria · out of scope · open
questions), the canonical generation template for a brief
([templates](../../architecture/templates.md)).

1. **Claude drives, the user steers.** It investigates the code (tool calls render as collapsed
   one-liners, expandable, never noise), then proposes brief sections one at a time as widgets.
2. **Open questions are a checklist, not scroll-back.** Anything genuinely the user's call lands in
   the brief's Open questions section with quick-reply options; answering one checks it off and
   folds the answer into the approach.
3. **Criteria get pushed on.** The template demands testable criteria; the UI flags weak ones
   ("sync should work well" ⚠). Deliberate friction: the implementation run is graded against them
   ([review](./review.md)).

## Ready gate

"Move to Ready" runs the **adversary review** and enables only when it passes and the brief is
complete: all sections set, no unresolved open questions ([board](./board.md) §Status state
machine). The adversary is a cold session (`adversary` kind,
[session-kinds](../../architecture/session-kinds.md)) that reads the finished brief with no chat
history and attacks it, naming where an implementer would stumble. Each critical finding renders as
a widget through `flag_risk`; accepting one files it as an open question, which blocks the gate
until the brief resolves it, and dismissing one records an override reason. A cold reader catches
what the author and the refine chat talked themselves past, so the gate blocks by default with a
deliberate override, not an advisory note.

## Slash shortcuts

Recurring moves, so the user never retypes them: `/split` (too big, propose two stories), `/shrink`
(cut to the smallest shippable version), `/risks` (what could go wrong), `/estimate` (blast
radius).
