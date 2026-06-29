# Live Provider Dogfood: GitHub CI and Vercel Preview

## Summary

- Date: 2026-06-26
- Provider presets: `github-ci`, `vercel-preview`
- Repo: `wkoverfield/switchboard`
- Runner: Wilson's local macOS source checkout
- Agent client or harness: Switchboard CLI plus MCP SDK stdio client
- Result: passed
- One-line finding: both real-provider paths can mount through Switchboard with
  local `secretRef`s, mandate scope, value-free output, and approval gates.

## Credential Posture

- GitHub token model used: local GitHub CLI token copied into Switchboard
  `secretRef`
- GitHub token owner/scope boundary: `wkoverfield` account; `repo`,
  `workflow`, `read:org`, and `gist` scopes observed from `gh auth status`
- Vercel token model used: local Vercel CLI token copied into Switchboard
  `secretRef`
- Vercel token owner/scope boundary: Wilson's authenticated Vercel CLI account
- Explicitly avoided scopes: no raw token in repo config, client config,
  mandate JSON, audit log, or report output
- Raw token stored only via `secretRef`: yes

## Commands Run

```bash
pnpm switchboard scan
gh auth token | pnpm switchboard auth github-ci --value-stdin
pnpm switchboard secrets doctor --json
pnpm switchboard doctor --json
pnpm switchboard test github_ci --json
pnpm switchboard presets check github-ci --profile github_ci --json
pnpm switchboard mandate create live-github-ci --from github-ci --branch main --json
pnpm switchboard approvals --mandate live-github-ci --json
pnpm switchboard deny approval-1 --reason dogfood-cleanup --json
pnpm switchboard mandate report live-github-ci --json
pnpm switchboard logs --mandate live-github-ci --json
pnpm switchboard test vercel_preview --json
pnpm switchboard presets check vercel-preview --profile vercel_preview --json
```

The Vercel token was copied from the local Vercel CLI auth file into
`vercel/example/preview/token` without printing the value.

## Preset Check Evidence

### GitHub CI

- `presets check` status: passed
- Total tools: 43
- Allowed: 26
- Approval-required: 15
- Denied: 2
- Not allowed: 0
- Allowed-sensitive: 0
- `allowed_sensitive` review: clean

Denied tools:

- `github_ci_create_repository`
- `github_ci_delete_file`

Approval-gated examples:

- `github_ci_issue_write`
- `github_ci_create_pull_request`
- `github_ci_push_files`
- `github_ci_merge_pull_request`
- `github_ci_update_pull_request`

### Vercel Preview

- `presets check` status: passed
- Total tools: 5
- Allowed: 5
- Approval-required: 0
- Denied: 0
- Not allowed: 0
- Allowed-sensitive: 0
- `allowed_sensitive` review: clean

Observed readonly tools:

- `vercel_preview_list_deployments`
- `vercel_preview_get_deployment`
- `vercel_preview_list_projects`
- `vercel_preview_get_deployment_events`
- `vercel_preview_get_runtime_logs`

The Vercel run used `VERCEL_ENABLED_TOOLGROUPS=readonly`, so write/admin tools
were absent from the tool surface.

## Mandate Evidence

### GitHub CI

- Mandate id: `live-github-ci`
- Branch binding: `main`
- Lease: `2h`
- Profiles mounted: `github_ci`
- Denied policy confirmed: yes
- Approval gates confirmed: yes
- `mcpLaunch` present in JSON: yes
- Report schema version: `switchboard.mandate-report.v1`

### Vercel Preview

- Mandate id: `live-vercel-preview`
- Branch binding: `fix/vercel-preview-template-dogfood`
- Lease: `2h`
- Profiles mounted: `vercel_preview`
- Denied policy confirmed: yes
- Approval gates confirmed: yes
- `mcpLaunch` present in JSON: yes

## Real Tool Exercise

| Tool | Intended action | Expected posture | Outcome | Notes |
| ---- | --------------- | ---------------- | ------- | ----- |
| `github_ci_get_me` | read authenticated GitHub user metadata | allowed | passed | response summarized only |
| `github_ci_issue_write` | write-shaped GitHub issue operation | approval-gated | passed | blocked before upstream write and created `approval-1` through daemon-backed MCP |
| `vercel_preview_list_projects` | read Vercel project list | allowed | passed | response summarized only |

## Approval Evidence

- Approval requests created: 1
- `switchboard approvals --mandate live-github-ci` readable: yes
- Approve/deny command copy clear: yes
- Upstream write blocked before approval: yes
- Retry after approval worked: not tested
- Cleanup: `approval-1` denied with reason `dogfood-cleanup`

## Secret/Audit Safety

- `.switchboard.yaml` contains only `secretRef`, not raw token: yes
- Agent/client MCP config contains no raw token: yes
- Mandate JSON contains no raw token: yes
- Audit logs contain no raw token: yes
- Mandate report contains no raw token: yes

## Policy Changes Required

- Tools to deny: none from this run
- Tools to require approval: none from this run
- Credential scope changes: future GitHub run should use a dedicated
  least-privilege token instead of Wilson's broad local GitHub CLI token
- Docs/runbook changes: Vercel dogfood result added to provider safety docs in
  PR #90
- Code changes: Vercel Preview template fixed in PR #90 to use
  `vercel-platform-mcp-server` with readonly toolgroups

## Alpha Decision

- Ready for non-Wilson alpha path: yes, for local setup and readonly provider
  inspection
- Blocking reason if no: not applicable
- Follow-up owner: Wilson / Switchboard agent
