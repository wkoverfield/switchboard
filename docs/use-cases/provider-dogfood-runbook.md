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

Start with the deterministic policy proof:

```bash
pnpm smoke:vercel-preview-dogfood
```

Then run real Vercel Preview dogfood only with an intentionally scoped preview
token:

```bash
SWITCHBOARD_LIVE_PROVIDER_DOGFOOD=1 \
SWITCHBOARD_VERCEL_PREVIEW_TOKEN=<project/team-scoped token> \
pnpm smoke:vercel-preview-live-dogfood
```

The live harness skips unless explicitly enabled, intentionally ignores ambient
`VERCEL_TOKEN`, and writes a redacted local summary to
`.switchboard-live-dogfood/`. If the upstream MCP server needs additional
scoping args, pass them as JSON:

```bash
SWITCHBOARD_VERCEL_MCP_ARGS_JSON='["--flag","value"]'
```

The manual equivalent is:

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

## Stripe Test

Start with the deterministic policy proof:

```bash
pnpm smoke:stripe-test-dogfood
```

Then run real Stripe test-mode dogfood only with a restricted test key:

```bash
SWITCHBOARD_LIVE_PROVIDER_DOGFOOD=1 \
SWITCHBOARD_STRIPE_TEST_KEY=<restricted sk_test_ or rk_test_ key> \
pnpm smoke:stripe-test-live-dogfood
```

The live harness skips unless explicitly enabled, refuses live-mode keys, and
writes a redacted local summary to `.switchboard-live-dogfood/`.

The manual equivalent is:

```bash
switchboard setup stripe-test
switchboard doctor
switchboard presets check stripe-test --profile stripe_test --json
switchboard mandate create --from stripe-test --json
switchboard mcp --mandate inspect-test-payments
```

Credential posture:

- Use a restricted test-mode secret key.
- Never use live-mode secret keys with `stripe-test`.
- Start with read access for test customers, charges, payment intents, and
  subscriptions.
- Add test-mode write/refund capability only when those tools remain
  approval-gated.

Acceptance:

- `presets check` returns `policy-covered`.
- `allowed_sensitive` is zero.
- Live/prod/account/payout/transfer/webhook-secret/token-shaped tools are
  denied.
- Test-mode create/update/refund/cancel/capture/confirm-shaped tools are
  approval-gated.
- `mandate report inspect-test-payments --json` contains no raw token values.

## Supabase Dev

Start with the deterministic policy proof:

```bash
pnpm smoke:supabase-dev-dogfood
```

Then run real Supabase dogfood only against a development project. Guided
`setup`/`auth` rejects obvious production, live, admin, root, and `service_role`
credential-looking values, but that is a guardrail, not proof of project scope:

```bash
SWITCHBOARD_LIVE_PROVIDER_DOGFOOD=1 \
SWITCHBOARD_SUPABASE_DEV_ACCESS_TOKEN=<development access token> \
SWITCHBOARD_SUPABASE_PROJECT_REF=<development project ref> \
pnpm smoke:supabase-dev-live-dogfood
```

The live harness skips unless explicitly enabled, intentionally ignores ambient
`SUPABASE_ACCESS_TOKEN`, requires an explicit project ref, launches the upstream
server with `--read-only --project-ref`, and writes a redacted local summary to
`.switchboard-live-dogfood/`. Additional upstream args can be passed with:

```bash
SWITCHBOARD_SUPABASE_MCP_ARGS_JSON='["--flag","value"]'
```

The manual equivalent is:

```bash
switchboard setup supabase-dev
switchboard doctor
switchboard presets check supabase-dev --profile supabase_dev --json
switchboard mandate create --from supabase-dev --json
switchboard mcp --mandate inspect-dev-db
```

For live dogfood, prefer an MCP launch that is explicitly read-only and
project-scoped, for example by keeping `--read-only` and adding the upstream
server's project-scoping argument when available. Do not claim full Supabase
least privilege until a real development-project MCP surface has been observed.

Credential posture:

- Use a Supabase access token scoped to a development project when possible.
- Never use production database credentials or `service_role` keys as agent MCP
  credentials.
- Start with read access for project metadata, schemas/tables, logs, and query
  plans.
- Add arbitrary SQL, migration, insert/update/upsert, or config-setting
  capability only when those tools remain approval-gated.

Acceptance:

- `presets check` returns `policy-covered`.
- `allowed_sensitive` is zero.
- Production, service-role, admin, root, destructive data/schema,
  secret/token, and credential-shaped tools are denied.
- Arbitrary SQL, migrations, create/insert/update/upsert, and configuration
  writes are approval-gated.
- `mandate report inspect-dev-db --json` contains no raw token values.

## Rules

- Do not store raw provider tokens in `.switchboard.yaml`, `.mcp.json`,
  `.codex/config.toml`, audit logs, or mandate payloads.
- Prefer narrowing credential scope first, then narrowing mandate policy.
- Treat every `allowed_sensitive` tool as a policy bug until reviewed.
- Do not add broad provider coverage until GitHub CI, Vercel Preview, and
  Supabase Dev survive this runbook against real provider tools or have clear
  fixture-only caveats.
