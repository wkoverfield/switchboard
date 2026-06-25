# Provider Dogfood Report Template

Use this template after each real-provider dogfood run. Keep raw tokens, private
keys, full bearer headers, and customer data out of the report. The report
should prove whether the provider path is safe enough for alpha use and identify
policy changes before more providers are added.

Recommended filename:

```text
docs/use-cases/provider-dogfood-results/YYYY-MM-DD-<provider>-<repo>.md
```

Create the `provider-dogfood-results/` directory only when there is a real
report to keep. Do not commit synthetic reports as proof.

## Summary

- Date:
- Provider preset: `github-ci` or `vercel-preview`
- Repo:
- Runner:
- Agent client or harness:
- Result: passed / needs-policy-change / failed
- One-line finding:

## Credential Posture

- Token model used:
- Token owner/scope boundary:
- Minimum scopes granted:
- Approval-gated scopes granted:
- Explicitly avoided scopes:
- Raw token stored only via `secretRef`: yes / no

Do not include the token value or screenshots where the token is visible.

## Commands Run

Record the exact Switchboard commands, with secret values omitted:

```bash
switchboard setup <preset>
switchboard doctor
switchboard presets check <preset> --profile <profile> --json
switchboard mandate create --from <preset> --json
switchboard mcp --mandate <mandate>
switchboard mandate report <mandate> --json
```

For source-checkout runs, include the local binary prefix used instead of
rewriting the commands to look globally installed.

## Preset Check Evidence

- `presets check` status:
- Total tools:
- Allowed:
- Approval-required:
- Denied:
- Not allowed:
- Allowed-sensitive:
- `allowed_sensitive` review:

Paste only redacted JSON snippets or summarized counts. If
`allowed_sensitive > 0`, mark the run as `needs-policy-change`, tighten the
deny/approval policy, and rerun before unattended use.

## Mandate Evidence

- Mandate id:
- Branch binding:
- Lease:
- Profiles mounted:
- Denied policy confirmed:
- Approval gates confirmed:
- `mcpLaunch` present in JSON: yes / no
- Report schema version:

## Real Tool Exercise

List the provider tools actually exercised. Use names and outcomes, not raw
provider payloads.

| Tool | Intended action | Expected posture | Outcome | Notes |
| ---- | --------------- | ---------------- | ------- | ----- |
|      |                 | allowed          |         |       |
|      |                 | approval-gated   |         |       |
|      |                 | denied           |         |       |

For GitHub CI, include at least one read/check/log inspection path. If rerun,
comment, review, branch push, update, or merge-shaped tools are exercised, they
must be approval-gated.

For Vercel Preview, include preview/log inspection. Production promotion,
environment variable, domain, secret/token, billing, and team administration
tools should be denied or absent. Deploy and rollback-shaped tools should be
approval-gated.

## Approval Evidence

- Approval requests created:
- `switchboard approvals --mandate <id>` readable: yes / no
- Approve/deny command copy clear: yes / no
- Upstream write blocked before approval: yes / no
- Retry after approval worked, if tested: yes / no / not tested

## Secret/Audit Safety

- `.switchboard.yaml` contains only `secretRef`, not raw token: yes / no
- Agent/client MCP config contains no raw token: yes / no
- Mandate JSON contains no raw token: yes / no
- Audit logs contain no raw token: yes / no
- Mandate report contains no raw token: yes / no

## Policy Changes Required

- Tools to deny:
- Tools to require approval:
- Credential scope changes:
- Docs/runbook changes:
- Code changes:

## Alpha Decision

- Ready for non-Wilson alpha path: yes / no
- Blocking reason if no:
- Follow-up owner:
