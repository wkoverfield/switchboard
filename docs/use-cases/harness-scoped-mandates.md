# Harness-Scoped Mandates

Switchboard is not an agent orchestrator. External harnesses decide what work to
assign, which agents to launch, and how those agents communicate. Switchboard
gives each launched agent a repo-aware MCP endpoint with the right profiles,
tool policy, lease, approvals, and audit trail.

For the versioned JSON surfaces used by this flow, see
`docs/use-cases/harness-json-contracts.md`.

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

6. Close and report the mandate when work is handed back:

```bash
switchboard --cwd /path/to/repo mandate handoff fix-ci \
  --state completed \
  --summary "CI is green" \
  --next-step "merge PR" \
  --artifact "https://github.com/org/repo/pull/214" \
  --by implementer-agent \
  --json

switchboard --cwd /path/to/repo mandate report fix-ci --json
```

`mandate handoff` closes runtime authority by moving the mandate out of `open`.
By default it refuses to close while local readiness blockers remain, such as
open child mandates or pending approval requests; `--ignore-readiness` is the
explicit override for softer local blockers like pending approvals. Core mandate
rules still block closing a parent while child mandates remain open.
`mandate report --json` is tagged with
`schemaVersion: "switchboard.mandate-report.v1"` and includes the mandate tree,
handoff counts, related approval requests, recent related audit entries, and a
`readiness` object that names open child mandates or pending approval requests
that should be handled before closing the selected mandate. It also includes
`results` rollups for handoff summaries, next steps, and artifacts across the
reported tree. `mandate escalate --json` turns those blockers and blocked
handoffs into a local escalation plan with suggested commands and copy text.

## Child Mandates

A harness or lead agent can create a narrower child mandate from an active
parent:

```bash
switchboard --cwd /path/to/repo mandate child rerun-checks \
  --parent fix-ci \
  --agent worker \
  --profiles github_findu \
  --branch fix/ci \
  --lease 30m \
  --allow-tool 'github_findu_checks_*' \
  --json
```

Child mandates inherit parent denied tools and approval gates. The child cannot
exceed the parent's repo, worktree, branch, profiles, allowed tool scope, or
lease. The JSON response includes the same `mcpLaunch` payload shape as
`mandate create --json`, so a harness can launch the worker through the child
mandate immediately.

V0 allowed-tool narrowing is intentionally conservative: exact matches, `*`,
and parent suffix wildcards like `github_findu_*` can authorize narrower child
patterns. Broader pattern implication can come later, but V0 should fail closed
rather than guess.

Parent handoff is intentionally blocked while child mandates remain open. A
harness should report child mandates first, then report the parent so the
delegation chain records every worker outcome before the lead authority closes.

## Future Delegation Work

Parent/child mandates currently persist:

- `parentMandateId`
- `delegatedBy`
- `delegationPath`
- `maxLeaseExpiresAt`
- narrowed `profiles`
- narrowed `allowedTools`
- inherited `deniedTools`
- inherited or stricter approval gates
- `handoffState`
- handoff summary, next steps, artifacts, actor, and timestamp

Future work should add richer approval escalation and result aggregation around
the delegation chain. Switchboard still does not orchestrate which agents run or
how they communicate.
