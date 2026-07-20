# permission-live spike

Throwaway scripts that drove the 002-02 live verification against the real
orchestrator (`node .stack/server.ts` with a gitignored `helm.config.json`
pointing at the scratch repo the setup script creates). Findings live in
`.knowledge/architecture/claude-integration.md` §Permission prompts.

- `setup-scratch.ts`: creates `/tmp/helm-scratch/repo` with five gated ready
  stories (hold, deny+ask, manual, auto, invalid-allowlist).
- `gen-story.ts`: writes the story files with a valid gate hash; optional
  second arg regenerates one file.
- `monitor.ts`: subscribes to the orchestrator's WS channels and prints every
  frame with a timestamp.
- `approve-loop.ts`: auto-approves every pending permission for one story.
- `hold-approve.ts`: holds one named permission past the CLI's default
  5-minute MCP window, approves it, then chains into approve-loop.
