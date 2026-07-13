# Switchboard

<!-- mcp-name: io.github.wkoverfield/switchboard -->

A firewall and password manager for your AI coding agents.

[![CI](https://github.com/wkoverfield/switchboard/actions/workflows/ci.yml/badge.svg)](https://github.com/wkoverfield/switchboard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@switchboard-mcp/cli)](https://www.npmjs.com/package/@switchboard-mcp/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Switchboard controls what Claude Code and Codex can reach in a repo. It finds
the MCP servers and tokens your agents can already touch, gets secrets out of
plaintext config and behind named keychain refs, and puts each agent on a
scoped pass that expires on its own.

![Switchboard grant: an agent is put on a scoped, expiring pass. It can reach only the named tools, everything else is denied, secrets stay in the keychain, and the pass ends on its own or with switchboard revoke.](https://raw.githubusercontent.com/wkoverfield/switchboard/main/examples/switchboard.gif)

Everything runs locally. No account, no hosted service, no telemetry.

## What it does

- `switchboard scan` shows which MCP servers and tokens agents can reach in
  this repo, and which routes bypass Switchboard entirely.
- `switchboard import` consolidates scattered Claude/Codex MCP config into one
  Switchboard route, with timestamped backups and exact rollback commands.
- Secrets live in your OS keychain as named refs. Config files carry
  `secretRef: "github/ci/token"`, never the token itself.
- `switchboard grant` puts the agent on a pass: named tools reachable,
  everything else denied, gone in a few hours.
- `switchboard status` answers whether a pass is live right now.
  `switchboard revoke` ends one early.
- Every tool call routed through Switchboard lands in a local audit log.
  `switchboard logs` reads it.

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

```text
$ switchboard scan

This looks like acme-app.

Detected:
- Codex Switchboard route missing
- Claude Switchboard route missing
- Claude direct MCP server "github" detected

Authority bypasses:
  high claude:github (github; direct-mcp-server, secret-env-name)

Warnings:
- 1 direct MCP bypass finding(s), including 1 high-risk finding(s), were detected.
```

That high-risk finding is a GitHub token sitting in plaintext in `.mcp.json`.
Move it behind Switchboard:

```bash
switchboard import --dry-run          # see the plan first
switchboard import --write --cleanup-client
switchboard secrets set <ref>         # store the token; import prints the exact command
switchboard install claude --write    # route the agent through Switchboard
```

Import rewrites client config to a single Switchboard route, replaces the
plaintext token with a named keychain ref, and leaves a backup plus the exact
rollback command. Import never reads secret values itself; the `secrets set`
step is where the token actually enters your keychain. Then scope the agent:

```bash
switchboard grant --for 4h
```

You get the pass above. When you want it gone early:

```text
$ switchboard revoke
Revoked pass grant-main (main). The agent's scoped access is off now.
```

`switchboard doctor` tells you the next thing to fix at any point. If a repo
has no MCP config yet, `switchboard setup github-ci` starts from a safe
provider template instead.

## What Switchboard does not do

- **It is not a sandbox.** Switchboard governs the paths routed through it:
  Switchboard MCP endpoints and `switchboard run`. An agent with raw shell
  access, a provider CLI, a browser session, or a direct MCP route can bypass
  it. `switchboard scan` reports those bypass routes so you can clean them up
  or accept them deliberately.
- **Backups keep your old config exactly as it was.** If a token was in
  plaintext before import, the backup still contains it. Rotate old tokens
  after migrating, and keep backups private.
- **A pass only binds routed agents.** `switchboard grant` says so itself when
  no client is wired up yet, and `switchboard install <claude|codex>` closes
  the gap.
- **It is alpha software.** Local-first workflows, conservative claims, rough
  edges. The pass and audit contracts are versioned JSON, but expect change.

## Commands

| Command | What it does |
| --- | --- |
| `switchboard scan` | Show what agents can reach in this repo, including bypass routes |
| `switchboard import` | Consolidate Claude/Codex MCP config into one guarded route |
| `switchboard grant` / `revoke` | Give the repo's agent an expiring scoped pass, or end it now |
| `switchboard status` | Is a pass live right now, and which config is active |
| `switchboard doctor` | Check the setup and print the next thing to fix |
| `switchboard setup <preset>` | Guided setup from a provider safety template (`switchboard presets list` shows them) |
| `switchboard auth <preset>` | Store the provider token for a preset in the keychain |
| `switchboard secrets` | Set, list, remove, and doctor named secret refs |
| `switchboard run` | Run an allowed provider command with pass-scoped credentials and audit |
| `switchboard install <client>` | Route Claude Code or Codex through Switchboard (add `--scope user` for one server across every repo) |
| `switchboard pass` | Create and inspect task-scoped passes with leases, gates, handoffs |
| `switchboard approvals` | Review and decide approval-gated tool calls |
| `switchboard tools` | List the tool surface a pass exposes |
| `switchboard logs` | Read the local audit log |
| `switchboard dashboard` | Local read-only dashboard: live passes, denials, audit stream |
| `switchboard audit` | Repo authority posture report, exportable as JSONL |

Commands that report state take `--json` for scripts and harnesses, with
versioned schemas. `switchboard <command> --help` has the rest.

## How it works

Switchboard reads layered YAML config (global, then `.switchboard.yaml`, then
`.switchboard.local.yaml`). Each profile names an upstream MCP server and the
secret refs it needs. At runtime, Switchboard mounts permitted profiles as one
MCP endpoint, resolves secret refs from the OS keychain only at launch, and
namespaces every tool so a pass can allow `github_ci_*` and deny everything
else. Passes, approvals, and audit entries are plain local files that reference
secrets by name, never by value.

Secret storage uses OS keychain backends by default. Plaintext fallbacks exist
for dev machines and CI, and require an explicit
`SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS=1` opt-in.

## For harnesses and subagent systems

`switchboard pass create --from github-ci --json` returns a
`workspaceLease.mcpLaunch` payload: the exact command to launch a
pass-scoped stdio MCP endpoint, plus the pass policy and lease. Switchboard
grants and audits authority; your harness owns scheduling, retries, and agent
processes. JSON contracts are documented in
[docs/use-cases/harness-json-contracts.md](docs/use-cases/harness-json-contracts.md).

## Alternatives

- **Project MCP config alone** works, but it is static wiring with tokens in
  files. Switchboard imports that wiring, moves the tokens, and adds scoped
  expiring access on top.
- **Docker MCP Gateway and MCP runtimes** run and package MCP servers well.
  Switchboard is the local authority layer above them, deciding which profile,
  tools, and lease an agent gets for a task. A gateway can be an upstream
  behind a Switchboard profile.
- **Hosted tool platforms** (Composio, Arcade) offer managed OAuth and broad
  SaaS coverage. Switchboard is local-first for coding-agent repos: local
  secrets, local audit, no hosted dependency.
- **Just giving the agent a token** is fast until the token is broad, live, or
  copied into the wrong file. That is the failure mode Switchboard exists for.

## Development

```bash
git clone https://github.com/wkoverfield/switchboard.git
cd switchboard
pnpm install
pnpm build
pnpm switchboard --help
pnpm test
```

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md), and report
vulnerabilities privately per [SECURITY.md](SECURITY.md).

Smoke tests and fresh-agent evals live in `scripts/`; CI runs the full set.
The top demo is a VHS tape: `brew install vhs && pnpm build && vhs examples/switchboard.tape`.
Deeper docs: [quickstart](docs/install/quickstart.md),
[threat model](docs/security/threat-model.md),
[provider safety templates](docs/providers/safety-templates.md),
[roadmap](docs/product/roadmap.md).

## License

MIT. See [LICENSE](./LICENSE).
