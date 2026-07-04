# Switchboard

A firewall and password manager for your AI coding agents.

Switchboard controls what Claude Code and Codex can reach in a repo. It finds
the MCP servers and tokens your agents can already touch, gets secrets out of
plaintext config and behind named keychain refs, and puts each agent on a
scoped pass that expires on its own.

![Switchboard grant: an agent is put on a scoped, expiring pass. It can reach only the named tools, everything else is denied, secrets stay in the keychain, and the pass ends on its own or with switchboard revoke.](https://raw.githubusercontent.com/wkoverfield/switchboard/main/examples/switchboard.gif)

Everything runs locally. No account, no hosted service, no telemetry.

## Install

```bash
npm install -g @switchboard-mcp/cli
```

Or without installing:

```bash
npx -y @switchboard-mcp/cli@latest scan
```

Requires Node 22 or newer. Daily use is on macOS, CI runs on Linux, and a
Windows keychain backend exists but gets less exercise.

## Quickstart

Start in a repo where your agents already work:

```bash
switchboard scan                            # what can agents reach here?
switchboard import --dry-run                # see the plan first
switchboard import --write --cleanup-client # one guarded route, token -> keychain ref
switchboard secrets set <ref>               # store the token (import prints the command)
switchboard install claude --write          # route the agent through Switchboard
switchboard grant --for 4h                  # scope the agent to an expiring pass
switchboard revoke                          # end it early
```

`switchboard doctor` tells you the next thing to fix at any point.

## What Switchboard does not do

- **It is not a sandbox.** Switchboard governs the paths routed through it
  (Switchboard MCP endpoints and `switchboard run`). An agent with raw shell
  access, a provider CLI, or a direct MCP route can bypass it. `switchboard
  scan` reports those bypass routes.
- **Backups keep your old config as it was.** If a token was in plaintext
  before import, the backup still contains it. Rotate old tokens after
  migrating.
- **A pass only binds routed agents.** `grant` says so itself when no client is
  wired up, and `install` closes the gap.
- **It is alpha software.** Conservative claims, versioned JSON contracts,
  rough edges.

## Full documentation

See the project on GitHub:
[github.com/wkoverfield/switchboard](https://github.com/wkoverfield/switchboard).

- [Quickstart](https://github.com/wkoverfield/switchboard/blob/main/docs/install/quickstart.md)
- [Trust model](https://github.com/wkoverfield/switchboard/blob/main/docs/security/trust-model.md)
- [Contributing](https://github.com/wkoverfield/switchboard/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/wkoverfield/switchboard/blob/main/SECURITY.md)

MIT licensed.
