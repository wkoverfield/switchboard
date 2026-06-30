# Switchboard Product Eval Strategy

Last updated: 2026-06-29

Switchboard should be evaluated against product usefulness, not only command
coverage. The current public-alpha hypothesis is:

> Find risky MCP/tool access in your repo and turn it into scoped agent
> permissions.

That breaks into three user-visible jobs:

1. Clean up existing MCP config spread across agent clients.
2. Let an agent use repo/provider tools without giving it everything.
3. Give long-running agents and harnesses scoped authority, expiry, audit, and
   handoff.

The 2026-06-27 adversarial published-alpha review is captured in
`docs/product/adversarial-alpha-eval-2026-06-27.md`.
The resulting build plan is captured in
`docs/product/alpha-authority-architecture-plan.md`.

## Eval Layers

### Deterministic Local Evals

Run these before changing launch copy, onboarding, mandate JSON contracts, or
provider setup flows:

```bash
pnpm eval:blind-alpha
pnpm eval:fresh-agent-package-import
pnpm eval:fresh-agent-import
pnpm eval:fresh-agent-github-ci
pnpm eval:fresh-agent-expired-mandate
pnpm eval:fresh-agent-subagent
pnpm eval:published-alpha
```

The fresh-agent evals exercise CLI behavior with minimal prompts and write
redacted summaries under `.switchboard-evals/`.
`pnpm eval:blind-alpha` is the closest deterministic rehearsal of the alpha
story: package install, messy Codex/Claude MCP config, import cleanup, client
install, mandate creation, status, report, and plain-English value check.
`pnpm eval:published-alpha` installs the public npm package in a clean temp
directory and checks the public launch claims from the same package a tester
would install.

Every eval summary includes an `evidence` object. Treat
`deterministic-scripted` as regression evidence, not proof that a true blind
tester understood the product.

### Adversarial Agent Reviews

Before a public-facing launch or major onboarding change, run three independent
agent reviews:

- skeptical solo developer who dislikes extra tooling and may prefer CLI/code
  mode over MCP
- security-minded devtools/platform engineer evaluating secretRefs, expiry,
  approval gates, and audit
- harness/subagent builder evaluating `workspaceLease`, JSON contracts,
  `mcpLaunch`, and code-mode/CLI escape hatches

Each reviewer should report exact commands, adoption likelihood, bounce points,
and the top five changes that would make Switchboard more useful.

After bypass cleanup, code-mode execution, or harness launch-contract changes,
rerun the same three personas and compare against the 2026-06-27 findings.

### Human Alpha Tests

A phase is not launch-ready until one non-Wilson developer can:

1. Install from npm.
2. Run `switchboard scan`.
3. Understand the recommended next action.
4. Complete either import cleanup or one provider setup.
5. Create a mandate/workspace lease.
6. Explain back why Switchboard is better than raw MCP/client config.

Use `docs/use-cases/blind-alpha-runbook.md` for non-Wilson human tests and
fresh-agent package rehearsals. Record the result as one of:

- `deterministic-scripted`: reproducible fixture eval; CI-friendly.
- `blind-agent`: a fresh coding agent following the runbook without hidden
  product context.
- `blind-human`: a non-Wilson developer using the package in a disposable repo.

## What Counts As Failure

- The user needs to understand "mandates" before seeing any value.
- The CLI prints several possible next steps but no recommended next step.
- A provider setup requires knowing MCP implementation details.
- A harness can use the JSON, but a human cannot understand the same flow.
- Safety claims are not backed by an actual block, approval, lease, secretRef,
  or audit artifact.
- Code-mode/CLI workflows bypass Switchboard because MCP is the only supported
  execution path.

## Current Known Gaps

Switchboard now has both MCP and `switchboard run --mandate ... -- <command>`
coverage for local authority paths. GitHub CI and Vercel Preview both have
deterministic provider-shaped fixture proof for allowed, approval-required,
denied, audit/report, and run-mode behavior. The remaining provider eval gap is
live least-privilege dogfood: repeat GitHub CI with a dedicated token, rerun
Vercel Preview with a project-scoped token/report, and run Stripe test-mode once
an MCP-authorized restricted test key is available.

Fresh-agent evals are deterministic usability probes, not substitutes for a
true non-Wilson alpha test. Before launch, keep at least one blind package-mode
run where the tester can explain the value as: Switchboard found and cleaned
repo MCP/tool access, then created bounded authority.
