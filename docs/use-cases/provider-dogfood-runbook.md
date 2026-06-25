# Provider Dogfood Runbook

Use this when testing Switchboard against real provider MCP servers and real
tokens. The goal is to prove the mandate model with least-privilege credentials,
not to broaden provider coverage.

After each run, copy `docs/use-cases/provider-dogfood-report-template.md` into a
dated report under `docs/use-cases/provider-dogfood-results/`. Commit only
redacted evidence: tool counts, policy decisions, approval behavior, and
token-safety checks. Do not commit raw provider tokens or private provider
payloads.

## GitHub CI

Start from the alpha golden path:

```bash
switchboard setup github-ci
switchboard doctor
switchboard presets check github-ci --profile github_ci --json
switchboard mandate create --from github-ci --json
switchboard mcp --mandate fix-ci
```

Credential posture:

- Start with repo-scoped read access for repository metadata, pull requests,
  checks/statuses, and workflow runs/logs.
- Add CI rerun, PR comment/review, branch push, or PR update access only when
  the matching tools stay approval-gated.
- Avoid org admin, repository deletion, repository creation, and production
  deployment credentials.

Acceptance:

- `presets check` returns `policy-covered`.
- `allowed_sensitive` is zero. If any tool is classified as
  `allowed_sensitive`, tighten the deny/approval policy and rerun until the
  check is policy-covered before unattended use.
- The mandate JSON includes `mcpLaunch`.
- Approval-required tools create local approval requests before provider writes.
- `mandate report fix-ci --json` includes useful audit/approval state and no raw
  token values.

Record after each run:

- token model used, without the token value
- discovered tool counts by classification
- tools that felt too broad, surprising, or under-gated
- approval requests created during the run
- policy changes made afterward
- a completed provider dogfood report using
  `docs/use-cases/provider-dogfood-report-template.md`

## Vercel Preview

Use Vercel Preview as the second provider proof, not a broad expansion:

```bash
switchboard setup vercel-preview
switchboard doctor
switchboard presets check vercel-preview --profile vercel_preview --json
switchboard mandate create --from vercel-preview --json
switchboard mcp --mandate inspect-preview
```

Credential posture:

- Start with project/team-scoped read access for project metadata, deployments,
  and build/runtime logs.
- Add preview deploy or rollback access only when those tools stay
  approval-gated.
- Avoid production promotion, environment variable writes, domain management,
  team administration, and billing administration.

Acceptance:

- Preview/log inspection works under a mandate.
- Production deploy/promotion, env, domain, secret/token, billing, and
  team-shaped tools are denied.
- Deploy and rollback-shaped tools are approval-gated.
- `mandate report inspect-preview --json` is useful after the investigation and
  contains no raw token values.

## Rules

- Do not store raw provider tokens in `.switchboard.yaml`, `.mcp.json`,
  `.codex/config.toml`, audit logs, or mandate payloads.
- Prefer narrowing credential scope first, then narrowing mandate policy.
- Treat every `allowed_sensitive` tool as a policy bug until reviewed.
- Do not add new providers until GitHub CI and Vercel Preview both survive this
  runbook against real provider tools.
