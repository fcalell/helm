---
id: 002-02
status: backlog
depends: [002-01]
branch: helm/002-02-permissions-needs-input
sessions: {}
---
# Permission presets & needs-input

## Goal

Runs are supervised: the story's permission preset (Guarded default, Auto, Manual) shapes what
prompts, the Auto allowlist is per-repo data under `.helm/`, and a headless permission prompt
surfaces as approve/deny buttons on the card (`.knowledge/product/features/runs.md` §Permission
presets). A run's `ask_user` flips the card to Needs input, renders the quick-reply form in the
drawer, and the answer resumes the session (§Needs input); the notification leg stays v2.
