# Harness-Scoped Mandates

Switchboard is not an agent orchestrator. External harnesses decide what work to
assign, which agents to launch, and how those agents communicate. Switchboard
gives each launched agent a repo-aware MCP endpoint with the right profiles,
tool policy, lease, approvals, and audit trail.

## Flow

1. Create a mandate for the task:

```bash
switchboard mandate create fix-ci \
  --agent implementer \
  --profiles github_findu,vercel_preview \
  --branch fix/ci \
  --lease 2h \
  --allow-tool 'github_findu_*' \
  --deny-tool '*_deploy_prod' \
  --json
```

2. Read the `mcpLaunch` payload from the JSON response:

```json
{
  "schemaVersion": "switchboard.mcp-launch.v1",
  "transport": "stdio",
  "mandateId": "fix-ci",
  "cwd": "/path/to/repo",
  "command": "switchboard",
  "args": ["--cwd", "/path/to/repo", "mcp", "--mandate", "fix-ci"]
}
```

3. Optionally inspect the scoped tool surface before launch:

```bash
switchboard --cwd /path/to/repo tools --mandate fix-ci --json
```

The JSON output is tagged with
`schemaVersion: "switchboard.tool-surface.v1"` and includes namespaced tools plus
any trusted `_meta.switchboard.approvalRequired` gate metadata so the harness can
display or preflight the scoped authority it is about to hand to the worker.

4. Launch the worker agent with that command and args as its MCP server.

5. Inspect mandate-scoped state and logs:

```bash
switchboard --cwd /path/to/repo mandate status fix-ci --json
switchboard --cwd /path/to/repo logs --mandate fix-ci --json
```

The mandate status JSON is tagged with
`schemaVersion: "switchboard.mandate-status.v1"`.

The `--cwd` argument is part of the launch payload so the scoped MCP endpoint is
repo-aware even when the harness process has a different working directory. Use
the same repo cwd when polling status or reading logs.

## Future Delegation Sketch

Parent/child mandates should eventually add fields like:

- `parentMandateId`
- `delegatedBy`
- `delegationPath`
- `maxLeaseExpiresAt`
- narrowed `profiles`
- narrowed `allowedTools`
- inherited `deniedTools`
- inherited or stricter approval gates

Child mandates must not exceed parent repo, worktree, branch, profile, tool,
lease, or approval scope. This document is only a schema sketch; the current
runtime does not create or enforce child mandates yet.
