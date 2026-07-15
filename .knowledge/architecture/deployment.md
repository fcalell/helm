# Deployment: homelab, private by construction

Helm runs on the homelab server; phone and desktop reach it remotely. The framing that decides
everything here: **the UI is a remote-code-execution panel** for the host (runs execute shell
commands, git has push access). Whoever reaches the UI owns the box, so exposure is designed, not
configured.

## Network exposure

- **Tailscale is the front door.** The orchestrator binds to the tailnet interface only; clients
  run the Tailscale app and reach `https://helm.<tailnet>.ts.net` from anywhere, cellular
  included. Tailscale Serve provides valid TLS. Zero public surface.
- Acceptable alternative when a VPN app is unwanted: **Cloudflare Tunnel + Cloudflare Access**
  (identity checked at the edge before a packet reaches the host).
- **Never a public port-forward with app-level password auth.** Not a corner worth cutting for an
  RCE panel.
- App-level auth arrives with the mobile surface (v2): a **session cookie** behind one shared
  secret, so a lost phone is not an open board. v1 has no auth; it runs on the dev laptop bound to
  localhost, and Tailscale is the only gate once hosted.

## Privilege containment

The orchestrator runs as a dedicated low-privilege user, or in a container mounting only: the
target repos, the `claude` binary + its config dir, and the worktrees directory. A misbehaving
run with a permissive preset is contained to what Helm legitimately touches. Outbound egress stays
open (the CLI needs Anthropic's API; notifications need ntfy/push endpoints). The mounted CLI
config is the one accepted hole: a run with Bash and open egress can read the OAuth token, so a
rogue run risks the Claude account, never the host.

## Claude auth on the server

`claude setup-token` on a browser machine → `CLAUDE_CODE_OAUTH_TOKEN` in the orchestrator's
environment (secret-managed, never committed). Keep `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`
out of that environment: they take precedence and would silently switch billing to the API
([claude-integration](./claude-integration.md) §Auth on a headless host).

## Serving the clients

One process serves API, WS, and the PWA's static assets: nothing else to reverse-proxy. Web push
requires the HTTPS origin Tailscale Serve already provides. Repos live server-side; the user's
laptop checkout is unrelated to the boards Helm manages.
