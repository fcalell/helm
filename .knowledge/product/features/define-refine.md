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
board tools (`propose_stories`, `update_brief`, `resolve_question`); the UI renders each tool call
as a widget with **accept / edit / reject**. Accepting is what writes the file; an edit or a
rejection with a reason goes back as the next resumed message. Claude never free-writes board files
during chat.

## Defining an epic

Entry: `n` → title + a rough paragraph, as messy as the user likes.

1. **Explore first, ask second.** Claude's opening move is reading the actual code, so its 2–4
   clarifying questions are informed ones, rendered as tappable quick-reply chips plus free text.
2. **Breakdown arrives as draft cards.** `propose_stories` renders each proposed story as a
   mini-card (title, one-line goal, dependency hints) with per-card accept/edit/reject and
   accept-all. A text reply ("merge 2 and 3, drop 4") triggers a re-proposal.
3. Accepted cards land in Backlog. The chat stays attached to the epic and resumes with full memory
   whenever reopened.

## Refining a story

Entry: open a Backlog card, `r`. The session is seeded with the epic conversation's conclusions,
the card, and the brief template (goal · approach · acceptance criteria · out of scope · open
questions).

1. **Claude drives, the user steers.** It investigates the code (tool calls render as collapsed
   one-liners, expandable, never noise), then proposes brief sections one at a time as widgets.
2. **Open questions are a checklist, not scroll-back.** Anything genuinely the user's call lands in
   the brief's Open questions section with quick-reply options; answering one checks it off and
   folds the answer into the approach.
3. **Criteria get pushed on.** The template demands testable criteria; the UI flags weak ones
   ("sync should work well" ⚠). Deliberate friction: the implementation run is graded against them
   ([review](./review.md)).

## Ready gate

"Move to Ready" enables only when all brief sections are set and no open questions remain
([board](./board.md) §Status state machine). Enabling it offers an optional **cold-read check**:
one cheap pass where Claude re-reads the finished brief without the chat context and names where an
implementer would stumble.

## Slash shortcuts

Recurring moves, so the user never retypes them: `/split` (too big, propose two stories), `/shrink`
(cut to the smallest shippable version), `/risks` (what could go wrong), `/estimate` (blast
radius).
