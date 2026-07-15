# Coding conventions

> **Load when:** writing or editing any TypeScript. Baseline code hygiene. No code exists yet;
> these bind from the first code commit. Toolchain files (`tsconfig.json`, `biome.json`) are
> created at that milestone, hand-owned and committed.

## TypeScript

- Strict everywhere. **Never use `any`.** Prefer `unknown` + narrowing.
- Modern TS: `?.`, `??`, `satisfies`, template-literal types, discriminated unions.
- Keep compiler options strict; don't loosen `strict` / `noUncheckedIndexedAccess`.
- Validate all external input with **Zod** at the boundary (HTTP API bodies, board-file
  frontmatter, `stream-json` events from the CLI); trust internal types within.

## Style & formatting

- **Biome** is the formatter/linter (hand-owned `biome.json`). Don't fight it.
- Tab indent · double quotes · semicolons · trailing commas in multiline · 80-col wrap.
- A root `.editorconfig` mirrors this for non-Biome editors; keep the two in sync. `biome.json`
  wins on conflict.

## Naming

- Components `PascalCase` · hooks `useCamelCase` · vars/functions `camelCase` · constants
  `UPPER_SNAKE_CASE` · files `kebab-case`.

## Comments

- **Only comment non-obvious code**: don't restate the code.
- **No design/architecture/product rationale in code comments.** The *why* lives in `.knowledge/`,
  never inline. A "why we chose this" comment reads as a fixed constraint and misleads later work.
  Reserve comments for non-obvious *technical* facts the code can't show: platform/library gotchas,
  API limits, non-obvious prop/data contracts.
- No comments referencing the task/PR/caller ("added for X").
- No historical info in comments: always show "how it works now".
- **Mark an approved shortcut with its ceiling, not a rationale.** When a deliberate simplification
  is *approved* (scope reductions are confirmed first, CLAUDE.md **Never reduce scope silently**),
  leave one `// TODO:` naming the known ceiling + the upgrade trigger (`// TODO: O(n²) scan; switch
  to a Map if the list grows past ~100`). That's a permitted non-obvious *technical* fact (the limit
  + when to revisit), not the forbidden *why*. Behavioral/scope deferrals go to
  `.knowledge/product/roadmap.md`, never a code comment.

## Error handling

- Validate inputs before acting on them. One error scheme at the API boundary, defined when the
  API is built and recorded in `.knowledge/architecture/`; don't invent parallel schemes per
  module.
