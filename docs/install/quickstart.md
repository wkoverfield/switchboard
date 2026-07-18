# Quickstart

One command sets up a machine: `switchboard setup` scans for existing MCP
config, consolidates the current repo's project client config into
Switchboard profiles, swaps plaintext tokens for `secretRef`s, routes agent
clients through a single user-scoped Switchboard server, and initializes the
machine-level config file. Every file it updates is backed up first, and one
command undoes all of it.

## Install

For the published package:

```bash
npm install -g @switchboard-mcp/cli
```

To work from source:

```bash
git clone https://github.com/wkoverfield/switchboard.git
cd switchboard
pnpm install
pnpm build
```

From a packaged install, use `switchboard ...`. From a source checkout, use
`pnpm switchboard ...` for the same commands. One-off experiments or harnesses
can use `npx -y @switchboard-mcp/cli@latest ...` without a global install.

## Set Up The Machine

```bash
switchboard setup
```

What it does, in order:

1. **Scan** the repo and machine: project and user-level client config
   (`.mcp.json`, `.codex/config.toml`, `~/.claude.json`,
   `~/.codex/config.toml`), provider hints, and direct MCP routes that bypass
   Switchboard. Read-only; secret values are never read or printed.
2. **Consolidate** the current repo: direct MCP servers in the repo's
   project-scope client config (`.mcp.json`, `.codex/config.toml`) become
   Switchboard profiles in `.switchboard.yaml`, with token env vars rewritten
   to `secretRef`s. User-level direct servers are never rewritten; they are
   surfaced as bypass findings, and `switchboard scan` shows the detail.
   Skippable with `--skip-import`; setup is machine-level first and works
   outside any repo.
3. **List the secrets to store.** Setup never reads token values. It prints
   the exact `switchboard secrets set <ref> --value-stdin` command for each
   `secretRef` the consolidated config points at.
4. **Route agent clients** at user scope: one trusted Switchboard server for
   every repo. Codex config (`~/.codex/config.toml`, or `$CODEX_HOME`) is
   written directly with a backup. Claude Code owns `~/.claude.json`, so setup
   prints the one-time `claude mcp add --scope user` command instead.
5. **Initialize the global config** at `~/.config/switchboard/config.yaml`
   (respecting `XDG_CONFIG_HOME`) with the machine-level policy stanza. This
   is where the default-on seatbelt denylist lives and can be tuned; see
   [The Seatbelt](../security/seatbelt.md).
6. **Install the Claude Code tripwire hook.** A PreToolUse Bash hook in
   `~/.claude/settings.json` denies catastrophe-class shell commands using
   the same seatbelt denylist. `--no-hooks` records an opt-out instead, and
   `switchboard hooks uninstall claude` removes the hook later.

Setup is idempotent: re-running it repairs what drifted, never duplicates
entries, and never re-backs-up unchanged files. It never starts or leaves a
daemon running.

Agents and scripts get the same flow with structured output and zero prompts:

```bash
switchboard setup --json
```

In human mode the only question is a single confirmation that Enter accepts.
Off a TTY there are no prompts at all.

### Undo

```bash
switchboard setup --rollback
```

One command reverses every write setup made: files setup updated are restored
from their timestamped backups, and files setup created (including the global
config) are removed. Rollback never destroys content it did not write: before
restoring an update it snapshots the current file, and a created file that
changed after setup is snapshotted before removal. The write record lives in
a setup manifest under `$XDG_STATE_HOME/switchboard/setup/` (default
`~/.local/state/`).

### After setup

```bash
switchboard secrets set <ref> --value-stdin   # once per ref setup printed
claude mcp add --scope user switchboard -- switchboard mcp
switchboard doctor
```

After setup, the seatbelt is on: catastrophe-class calls (production
deploys, live payment keys, DNS mutations, force-pushes to the default
branch) are denied with an approvable retry, and everything else feels
exactly the same. [The Seatbelt](../security/seatbelt.md) has the exact
list, the approval flow, and the `seatbelt: off` opt-out.

`switchboard doctor` reports one top-level readiness status:

- `ok`: ready enough to use
- `setup-incomplete`: config is valid, but setup still needs action
- `failed`: a blocking issue must be fixed before use

## Give An Agent A Pass

Provider presets add a scoped profile and store the provider token in one
flow. For a bounded GitHub CI task:

```bash
switchboard setup github-ci
switchboard pass create --from github-ci
```

Then run the agent through the pass-scoped endpoint and inspect what it can
reach:

```bash
switchboard tools --mandate fix-ci
switchboard mcp --mandate fix-ci
switchboard pass report fix-ci --json
```

For approval-gated tools, either let the client use MCP elicitation when it
is available or approve from another terminal:

```bash
switchboard approvals --mandate fix-ci
switchboard approve <approval-id> --reason "CI rerun approved"
```

Production-safe defaults here mean concrete local guardrails: repo-correct
profiles, token values hidden behind `secretRef`s, non-prod/preview posture
where the template can express it, risky provider tools denied or
approval-gated under a pass, and a local audit trail. Switchboard is
runtime-aware, not a sandbox guarantee.

Backup hygiene: cleaned active config is `secretRef`-based, but rollback
backups are exact copies of the original client config. If the old config
contained raw tokens or env values, the backup can contain them too. Keep
backups local/private and rotate or remove old raw secrets after migration.

## Appendix: Manual Steps

`switchboard setup` composes commands that also run standalone. Use them
individually to inspect each step before writing.

### Scan and import

```bash
switchboard scan
switchboard import --dry-run
switchboard import --write
switchboard import --write --cleanup-client
```

`switchboard import --dry-run` is read-only. Use it when a repo already has
Codex or Claude MCP config; it reports existing servers, env variable names,
recommended Switchboard profiles, local token aliases, and cleanup actions
without writing config or reading secret values. When the plan looks right,
`switchboard import --write --cleanup-client` applies the repo
`.switchboard.yaml` profile changes and removes direct MCP bypasses from
active Codex/Claude project config with timestamped rollback backups.
(`setup` runs the plain `--write`; the `--cleanup-client` removal step stays
explicit.)

### Provider profile and token

```bash
switchboard add github-ci --write
switchboard auth github-ci
switchboard presets check github-ci --profile github_ci
```

`switchboard add` previews and writes the profile without touching tokens;
`switchboard auth` stores the token behind the preset's `secretRef`. For
scripts or custom refs, use the lower-level command:

```bash
switchboard secrets set <ref>
switchboard secrets set <ref> --value-stdin
```

The token value is never printed. The preset check starts the configured MCP
server, discovers its namespaced tools, and classifies them against the
template's recommended pass policy. Treat `allowed_sensitive` as a signal to
tighten the policy before unattended work.

### Client config

Preview, write, or restore project-scoped client config:

```bash
switchboard install codex
switchboard install codex --write
switchboard install codex --rollback <backup>
switchboard install claude --write
```

User scope registers one server for every repo instead:

```bash
switchboard install codex --scope user --write
switchboard install claude --scope user
```

Every update to an existing client config creates a timestamped backup. The
generated snippets run `switchboard mcp` (project scope pins `--cwd <repo>`),
which auto-starts the local daemon and routes MCP traffic through it.

### Pass lifecycle

```bash
switchboard pass create --from github-ci
switchboard tools --mandate fix-ci
switchboard mcp --mandate fix-ci --approval-wait 30s
switchboard logs --mandate fix-ci
switchboard pass handoff fix-ci \
  --state completed \
  --summary "CI is green" \
  --next-step "merge after review" \
  --by implementer-agent
switchboard pass report fix-ci --json
```

### Local demo without GitHub

To exercise the pass approval path without a provider token, use the fixture
walkthrough:

```bash
pnpm build
pnpm smoke:mandate-walkthrough
```

To exercise the GitHub CI setup planner without a real token:

```bash
pnpm build
pnpm smoke:provider-add
```
