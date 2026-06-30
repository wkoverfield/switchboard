# Blind Alpha Runbook

Audience: a non-Wilson developer or fresh coding agent with no hidden
Switchboard context.

Goal: prove the first public-alpha aha:

> Switchboard found and cleaned repo MCP/tool access, then created bounded
> authority.

This runbook is intentionally not a provider dogfood. It can run with fixture
or fake credentials so the tester can focus on first-run comprehension, cleanup
safety, client install, mandate creation, and report inspection.

## Evidence Types

Use three labels when recording results:

- `deterministic-scripted`: a repeatable fixture eval run by CI or a developer.
- `blind-agent`: a fresh coding agent given this runbook and no extra product
  explanation.
- `blind-human`: a non-Wilson developer trying the package flow.

Deterministic evals catch regressions. Blind-agent and blind-human runs catch
the product language and workflow failures that scripts cannot feel.

## Setup

Create a temp repo or use a disposable fixture repo:

```bash
mkdir /tmp/switchboard-blind-alpha
cd /tmp/switchboard-blind-alpha
git init -b main
mkdir .codex
```

Add intentionally messy project MCP config. Use fake values only:

```toml
# .codex/config.toml
[mcp_servers.github]
command = "docker"
args = ["run", "-e", "GITHUB_TOKEN=ghp_fake_value", "ghcr.io/github/github-mcp-server"]
env = { GITHUB_TOKEN = "ghp_fake_value" }

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
```

```json
{
  "mcpServers": {
    "vercel": {
      "command": "npx",
      "args": ["-y", "vercel-mcp"],
      "env": {
        "VERCEL_TOKEN": "vercel_fake_value"
      }
    }
  }
}
```

Save the JSON as `.mcp.json`.

## Package Flow

Run the same shape a public alpha tester should run:

```bash
npx -y @switchboard-mcp/cli scan
npx -y @switchboard-mcp/cli import --dry-run
npx -y @switchboard-mcp/cli import --write --cleanup-client
npx -y @switchboard-mcp/cli doctor
```

Expected checkpoints:

- `scan` reports `Authority status: bypass-present`.
- `import --dry-run` shows a before/after cleanup plan.
- `import --write --cleanup-client` creates timestamped backups.
- `doctor` gives one best next command instead of looping back to a dry run.
- Raw fake secret values are not printed in normal Switchboard output.

Backup hygiene: active cleaned config should move toward `secretRef`s, but
rollback backups are exact copies of the original client config. If the old
config contained raw values, the backup can contain them. Keep the fixture
private and delete it after the test.

## Client Install

Install project-scoped Switchboard MCP endpoints:

```bash
npx -y @switchboard-mcp/cli install codex --write
npx -y @switchboard-mcp/cli install claude --write
npx -y @switchboard-mcp/cli doctor
```

Expected checkpoints:

- Codex and Claude project configs point to Switchboard, not direct provider
  MCP servers.
- If setup remains incomplete, the output says exactly which secret or mandate
  step is next.
- Direct accepted risks, if any, remain visible and prevent a fully
  `controlled` status.

## Bounded Authority

For a no-live-token fixture, use the scripted eval:

```bash
pnpm eval:blind-alpha
```

For a real GitHub CI authority run, continue from the repo under test:

```bash
npx -y @switchboard-mcp/cli setup github-ci
npx -y @switchboard-mcp/cli mandate create --from github-ci --json
npx -y @switchboard-mcp/cli mandate status fix-ci
npx -y @switchboard-mcp/cli mandate report fix-ci --json
```

Expected checkpoints:

- `setup github-ci` stores the token locally and does not print it.
- `mandate create --from github-ci --json` returns `workspaceLease` and
  `mcpLaunch`.
- `mandate status` is summary-first and shows MCP/run/report commands.
- `mandate report` ties readiness, approvals, audit, and handoff state to the
  mandate id.

## Scorecard

Record a redacted summary under `.switchboard-evals/` or in the PR notes:

- Install: package command worked without a source checkout.
- Scan/import: tester saw what was risky or messy by name.
- Cleanup: tester understood what changed and where backups are.
- Recovery: missing secrets or incomplete setup had exact next commands.
- Client install: Codex/Claude route through Switchboard in project scope.
- Authority: tester created or inspected a mandate/workspace lease.
- Safety: no raw secret values appeared in stdout, stderr, logs, reports, or
  summaries.
- Value explanation: tester can say, in their own words, "Switchboard found and
  cleaned repo MCP/tool access, then created bounded authority."

P0/P1 findings block public-alpha launch copy. P2 findings should become
follow-up issues unless they undermine first-run comprehension.
