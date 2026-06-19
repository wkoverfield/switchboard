# Switchboard

One local MCP endpoint for every account, project, and environment.

Switchboard is a local-first MCP profile router for developers using Codex, Claude Code, Cursor, VS Code, and other MCP-compatible agents. It is designed to make multi-account, multi-project, and dev/staging/prod tool access explicit, namespaced, policy-aware, and locally auditable.

This repository is in Milestone 0/1. It currently ships the TypeScript workspace, CLI shell, config/profile schemas, namespace normalization, collision detection, `switchboard status`, and `switchboard doctor`.

## Install From Source

```bash
pnpm install
pnpm build
pnpm --filter @switchboard-mcp/cli switchboard --help
```

## Current Commands

```bash
switchboard --help
switchboard status
switchboard doctor
```

## Config Files

Switchboard reads layered YAML config:

```text
$XDG_CONFIG_HOME/switchboard/config.yaml
~/.config/switchboard/config.yaml
.switchboard.yaml
.switchboard.local.yaml
```

This repo includes a safe `.switchboard.yaml` fixture so `switchboard status` and `switchboard doctor` exercise repo config discovery. Copy `.switchboard.local.example.yaml` to `.switchboard.local.yaml` for local-only overrides; the real local override file is gitignored.

Precedence, highest to lowest:

1. CLI overrides
2. environment variables
3. `.switchboard.local.yaml`
4. nearest `.switchboard.yaml`
5. global config
6. built-in defaults

Provider integrations, the MCP daemon, upstream routing, secrets, audit logs, and client installers come in later milestones.
