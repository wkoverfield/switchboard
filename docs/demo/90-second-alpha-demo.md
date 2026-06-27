# 90-Second Alpha Demo

Goal: show the aha path without live credentials.

## Script

```bash
pnpm build
pnpm smoke:package-install
pnpm eval:fresh-agent-import
pnpm eval:fresh-agent-github-ci
pnpm eval:fresh-agent-expired-mandate
pnpm eval:fresh-agent-subagent
```

Before public alpha, verify npm publish status:

```bash
npm view @switchboard-mcp/cli version
```

If this returns `404 Not Found`, use the source install and package-install
smoke above. Do not send testers to `npm install -g @switchboard-mcp/cli` until
the package is actually published.

Narration:

1. `scan/import` sees existing MCP setup and produces a cleanup plan without
   reading or printing secret values.
2. `setup/add` turns provider access into a repo-scoped Switchboard profile
   with local `secretRef` storage.
3. `mandate create --from github-ci --json` returns a bounded workspace lease
   and `mcpLaunch` payload for an agent or harness.
4. Runtime readiness catches expired authority and points to
   `switchboard mandate renew`.
5. Parent/child mandates show agents scoping narrower agents while Switchboard
   remains the authority/control plane, not the orchestrator.

Close with:

```bash
switchboard mandate report fix-ci --json
```

The report is the handoff: what authority existed, which tools were available,
which approvals blocked work, and what happened.
