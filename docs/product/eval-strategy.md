# Switchboard Product Eval Strategy

Last updated: 2026-06-27

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

## Eval Layers

### Deterministic Local Evals

Run these before changing launch copy, onboarding, mandate JSON contracts, or
provider setup flows:

```bash
pnpm eval:fresh-agent-import
pnpm eval:fresh-agent-github-ci
pnpm eval:fresh-agent-expired-mandate
pnpm eval:fresh-agent-subagent
pnpm eval:published-alpha
```

The fresh-agent evals exercise source-built CLI behavior with minimal prompts.
`pnpm eval:published-alpha` installs the public npm package in a clean temp
directory and checks the public launch claims from the same package a tester
would install.

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

### Human Alpha Tests

A phase is not launch-ready until one non-Wilson developer can:

1. Install from npm.
2. Run `switchboard scan`.
3. Understand the recommended next action.
4. Complete either import cleanup or one provider setup.
5. Create a mandate/workspace lease.
6. Explain back why Switchboard is better than raw MCP/client config.

## What Counts As Failure

- The user needs to understand "mandates" before seeing any value.
- The CLI prints several possible next steps but no recommended next step.
- A provider setup requires knowing MCP implementation details.
- A harness can use the JSON, but a human cannot understand the same flow.
- Safety claims are not backed by an actual block, approval, lease, secretRef,
  or audit artifact.
- Code-mode/CLI workflows bypass Switchboard because MCP is the only supported
  execution path.

## Current Known Gap

Switchboard has strong MCP and harness JSON coverage. It does not yet provide a
first-class `switchboard run` / `switchboard env` path for agents that execute
provider CLIs or generated code instead of connecting through MCP. This should
be considered part of the next usefulness frontier.
