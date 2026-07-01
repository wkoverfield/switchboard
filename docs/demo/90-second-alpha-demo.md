# 90-Second Alpha Demo

Goal: show the aha path without live credentials.

## Script

```bash
pnpm build
pnpm eval:blind-alpha
pnpm smoke:package-install
pnpm eval:fresh-agent-import
pnpm eval:fresh-agent-github-ci
pnpm eval:fresh-agent-expired-mandate
pnpm eval:fresh-agent-subagent
pnpm eval:published-alpha
```

Verify npm publish status:

```bash
npm view @switchboard-mcp/cli version
```

This should return `0.1.2` or newer. The published-package eval installs
`@switchboard-mcp/cli` from npm in a clean temp directory, then checks the
three launch claims: MCP cleanup, scoped provider setup, and harness-ready
workspace leases.

The blind-alpha eval is a deterministic package-mode rehearsal, not a true
blind human test. It should still produce the core acceptance sentence:
Switchboard found and cleaned repo MCP/tool access, then created bounded
authority.

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
6. The public npm package path works without a source checkout.

Close with:

```bash
switchboard mandate report fix-ci --json
```

The report is the handoff: what authority existed, which tools were available,
which approvals blocked work, and what happened.
