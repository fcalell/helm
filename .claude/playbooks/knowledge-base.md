# Knowledge base conventions

> **Load when:** adding, editing, splitting, or relocating anything under `.knowledge/`.

`.knowledge/` is the living source of truth for *what Helm is and why* (product, architecture).
Keep it current. Its index is imported into every session via `CLAUDE.md`.

- Each entry is a standalone `.md` file in the right subfolder (`product/`, `architecture/`).
  Filename: `kebab-case-descriptive-name.md`. Entries are durable *what/why* reference, written
  present-tense ("how it works now"), not changelogs or build journals.
- **One topic per file; nest a folder when a domain has many.** Keep each file focused on a single
  topic so a session loads only what it needs (context optimization), and so links can target the
  exact topic. When a domain spans several topics, give it its own subfolder of small files
  (`product/features/`) instead of one monolith; split a file once it has grown into several
  loosely-related sections.
- Each file opens with a `# Title` and a one-paragraph summary. Factual and concise: reference
  material, dense for LLM consumption, not prose.
- **Cross-reference by relative file link or named anchor, never a section number.** Link to another
  entry with a relative path (`[runs](../product/features/runs.md)`); reference a section *within* a
  file by its heading name (`§Queue & rate limits`). **Never** cite a numbered section (`§9`):
  numbers break silently when content is added, removed, or reordered.
- **Always update `.knowledge/index.md`** (the always-loaded navigation map) when adding, renaming,
  removing, or relocating an entry.
- Prefer **updating an existing entry** over creating a new one when topics overlap.
- **Decisions are recorded inline** in the doc they govern (product rationale in `product/`,
  architecture rationale in the relevant `architecture/` file), not as a separate dated ADR log.
  Revise rationale in place when it changes; don't leave stale parallel logs or dated history to
  pollute context.
- **File researched findings back into the KB.** When a session turns up something durable (a
  platform/library gotcha, a Claude Code CLI behavior, a debugging discovery, a design or
  architecture decision reached in chat), record it in the relevant entry (or a new one) so it
  compounds, instead of leaving it to evaporate in conversation.
- **Capture only what the code can't tell you**: invariants, the *why* behind non-obvious choices,
  gotchas, and designed-but-not-yet-built intent. Don't recite column lists, file trees, or
  dependency versions that mirror the source.
- When product behavior changes, update the relevant `product/features/` entry (and the matching
  `architecture/` entry if mechanics change) in the same commit as the code.
