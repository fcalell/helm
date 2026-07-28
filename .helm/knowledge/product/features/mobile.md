# Mobile: the supervision surface

The phone is not a small desktop. Desktop is where epics and stories get *shaped* (keyboard,
side-by-side panes); the phone is where runs get *supervised*. The mobile surface optimizes three
interrupt moments, each entered from a notification:

- **Needs input**: notification → the question's quick-reply form → tap → the run resumes
  ([runs](./runs.md) §Needs input). The reason an agent never sits blocked for hours.
- **Review**: notification "run finished, 5/6 ✓" → the self-graded criteria checklist first, diff
  second ([review](./review.md)): a checklist reads well on a phone, a raw diff doesn't → approve /
  request changes from the checklist.
- **Glance**: what's running, what's queued, rate-limit headroom.

## Form factor

A **PWA installed to the home screen** (iOS supports web push for installed PWAs since 16.4; no app
stores for a personal tool). Narrow screens collapse the board to a single-column status list and
the drawer to a full-screen sheet; the WebSocket sync the desktop already uses makes phone and
desktop live views of the same board. Reached over Tailscale, never the public internet
([deployment](../../architecture/deployment.md)).

## Notifications

Events: run finished · needs input · permission prompt (Guarded preset) · queue auto-paused on
rate limit. Primary channel is web push from the orchestrator; **ntfy (or a Telegram bot) is the
pragmatic fallback** if web push proves flaky on iOS: homelab-standard, reliable, one HTTP POST.
Every notification deep-links to the exact card + tab it concerns.
