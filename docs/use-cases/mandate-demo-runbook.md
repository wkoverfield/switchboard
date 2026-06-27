# Mandate Demo Runbook

This runbook is the human version of the CI walkthrough smoke. It is meant for
local dogfooding and demos before real provider presets or secrets exist.

The demo uses the repo's fixture MCP profile, so it does not need provider
tokens, cloud accounts, or production credentials.

## Setup

From a Switchboard checkout:

```bash
pnpm install
pnpm build
export SWITCHBOARD_REPO="$PWD"
export SWITCHBOARD_DEMO_TASK="demo-ci-$(date +%s)"
export SWITCHBOARD_DEMO_BRANCH="$(git -C "$SWITCHBOARD_REPO" branch --show-current 2>/dev/null)"
export SWITCHBOARD_DEMO_BRANCH="${SWITCHBOARD_DEMO_BRANCH:-main}"
```

Use the source checkout CLI through pnpm:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" status
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" doctor
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" test switchboard_fixture
```

To print a repo/profile-specific version of this walkthrough:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" demo mandate switchboard_fixture
```

## Create A Demo Mandate

Create a task-scoped mandate around the fixture profile:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" mandate create "$SWITCHBOARD_DEMO_TASK" \
  --agent implementer \
  --profiles switchboard_fixture \
  --branch "$SWITCHBOARD_DEMO_BRANCH" \
  --lease 30m \
  --allow-tool 'switchboard_fixture_*' \
  --require-approval-tool switchboard_fixture_echo \
  --require-approval-reason "demo echo call changes pretend remote state" \
  --require-approval-risk low \
  --require-approval-label demo
```

The command prints copyable next commands. They include explicit
`--cwd <repo>` context so they still work when copied from a different shell
directory. Those generated hints assume the `switchboard` binary is installed
and on `PATH`; when dogfooding from a source checkout, keep using the
`pnpm --filter @switchboard-mcp/cli switchboard` prefix shown in this runbook.

## Inspect The Scope

For humans:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" tools --mandate "$SWITCHBOARD_DEMO_TASK"
```

For harnesses:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" tools --mandate "$SWITCHBOARD_DEMO_TASK" --json
```

The JSON response uses `schemaVersion: "switchboard.tool-surface.v1"` and shows
`_meta.switchboard.approvalRequired` on the gated fixture tool.

## Launch A Scoped MCP Endpoint

The mandate can be used as the MCP endpoint for an agent:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" mcp --mandate "$SWITCHBOARD_DEMO_TASK"
```

That command speaks MCP over stdio, so it waits for an MCP client instead of
printing a normal terminal UI. In a real demo, wire this command into Codex,
Claude Code, or a harness as the MCP server command.

To exercise the full MCP approval path without hand-wiring an agent client, run
the automated walkthrough smoke:

```bash
pnpm smoke:mandate-walkthrough
```

That smoke launches the built CLI, calls a gated MCP tool, creates a local
approval request, approves it, retries the call, checks logs, and closes the
mandate.

## Inspect Approvals And Logs

After a gated tool call creates an approval request:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" approvals --mandate "$SWITCHBOARD_DEMO_TASK"
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" approvals --mandate "$SWITCHBOARD_DEMO_TASK" --json
```

For a live human queue while an MCP call is waiting:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" approvals --mandate "$SWITCHBOARD_DEMO_TASK" --watch
```

For a bounded agent-readable snapshot:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" approvals --mandate "$SWITCHBOARD_DEMO_TASK" --watch --timeout 0 --json
```

Approve or deny a pending request:

```bash
pnpm --filter @switchboard-mcp/cli switchboard approve <approval-id> --reason "demo approved"
pnpm --filter @switchboard-mcp/cli switchboard deny <approval-id> --reason "demo denied"
```

Inspect mandate-scoped audit entries:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" logs --mandate "$SWITCHBOARD_DEMO_TASK"
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" logs --mandate "$SWITCHBOARD_DEMO_TASK" --json
```

## Close The Mandate

When the demo task is done:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" mandate handoff "$SWITCHBOARD_DEMO_TASK" \
  --state completed \
  --summary "Demo finished" \
  --next-step "Try a real profile once secrets/provider work exists" \
  --by human-demo
```

Then inspect the report:

```bash
pnpm --filter @switchboard-mcp/cli switchboard --cwd "$SWITCHBOARD_REPO" mandate report "$SWITCHBOARD_DEMO_TASK" --json
```

## What This Proves

- repo-aware config and profile selection
- task-scoped mandate creation
- namespaced tool surface preflight
- approval-required tool metadata
- daemon-backed scoped MCP launch
- local approval request lifecycle
- mandate-scoped audit inspection
- handoff and report surfaces

## What This Does Not Prove Yet

- provider presets
- provider OAuth or token storage
- OS keychain-backed secrets
- production deployment approval flows
- remote approval services
- full agent orchestration

Those require the upcoming secrets/keychain and provider-preset architecture
decisions.
