# Stripe Test And Live MCP

`stripe-test` is the first money-shaped safety proof. The point is not broad
Stripe support; it is to show that an agent can inspect test-mode payment data
without receiving live-money authority by default.

## What Ships Now

The deterministic smoke uses a Stripe-shaped fixture MCP server:

```bash
pnpm smoke:stripe-test-dogfood
```

It proves:

- `switchboard add stripe-test --write` creates a repo-aware test profile and
  local `secretRef`
- `presets check stripe-test` classifies read tools as allowed
- create/update/refund/cancel/capture/confirm-shaped tools require approval
- live, production, payout, transfer, account, webhook-secret, token, and
  secret-shaped tools are denied
- `mandate create --from stripe-test` can infer the one configured Stripe
  profile without `--profiles`
- tool surface, mandate report, and CLI output do not print the raw token value

The fixture is intentionally conservative. It validates Switchboard's policy and
authority plumbing without touching real Stripe data.

## Real Stripe Test-Mode Dogfood

Run this only with a restricted Stripe test-mode secret key. Do not use live
keys.

```bash
switchboard setup stripe-test
switchboard doctor
switchboard presets check stripe-test --profile stripe_test --json
switchboard mandate create --from stripe-test --json
switchboard mcp --mandate inspect-test-payments
switchboard mandate report inspect-test-payments --json
```

Acceptance:

- discovered real Stripe MCP tool names are recorded in a redacted dogfood
  report
- `allowed_sensitive` is zero
- live/prod/account/payout/transfer/webhook-secret/token-shaped tools are denied
- payment-affecting test-mode writes are approval-gated
- raw key values do not appear in CLI output, MCP responses, audit logs, reports,
  or transcripts

Record results in `docs/use-cases/provider-dogfood-results/` using
`docs/use-cases/provider-dogfood-report-template.md`.
