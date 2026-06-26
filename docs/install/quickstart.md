# Quickstart

Use this path to make one repo ready for a bounded GitHub CI agent task. The
flow is local-first: Switchboard scans the repo for local tool/account hints,
writes repo config, stores provider tokens behind `secretRef`s, installs a
single local MCP endpoint into agent clients, and creates mandates for
task-scoped authority.

Canonical alpha flow:

For a normal alpha install:

```bash
npm install -g @switchboard-mcp/cli
```

From a packaged install, use `switchboard ...`. From a source checkout, run
`pnpm build` once and use `pnpm switchboard ...` for the same commands. For
one-off experiments or harnesses, `npx -y @switchboard-mcp/cli@latest ...`
runs the same binary without a global install.

Start by scanning the repo. This is read-only and local: it reports repo,
client, provider, and environment hints by name without printing secret values.

```bash
switchboard scan
switchboard setup github-ci
switchboard doctor
switchboard presets check github-ci --profile github_ci
switchboard install codex --write
switchboard mandate create --from github-ci
switchboard mcp --mandate fix-ci
switchboard mandate report fix-ci --json
```

Production-safe defaults here mean concrete local guardrails: repo-correct
profiles, token values hidden behind `secretRef`s, non-prod/preview posture where
the template can express it, risky provider tools denied or approval-gated under
a mandate, and a local audit trail. Switchboard is runtime-aware, not a sandbox
guarantee.

If you want to inspect each step before writing, use the manual flow:

```bash
switchboard add github-ci --write
switchboard doctor
switchboard auth github-ci
switchboard presets check github-ci --profile github_ci
switchboard install codex --write
switchboard mandate create --from github-ci
switchboard mcp --mandate fix-ci
switchboard mandate report fix-ci --json
```

## 1. Add GitHub CI

Guided setup writes the GitHub CI profile and stores the token in one flow:

```bash
switchboard setup github-ci
```

Paste the GitHub token when prompted and press Enter. The token value is not
printed.

For a transparent plan before writing, preview the setup:

```bash
switchboard add github-ci
```

The plan shows the `.switchboard.yaml` change, the `secretRef` command, the
provider check command, Codex/Claude install commands, and a recommended
mandate command. It does not write by default.

Write or update `.switchboard.yaml`:

```bash
switchboard add github-ci --write
```

The default GitHub CI template uses GitHub's official local MCP server through
Docker:

```text
docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server
```

Customize the profile, namespace, secret ref, command, or args when needed:

```bash
switchboard add github-ci \
  --profile-name github_findu \
  --namespace "GitHub FindU" \
  --secret-ref github/findu/dev/token \
  --write
```

## 2. Connect GitHub

Switchboard config stores only a printable `secretRef`; the token value goes
into the local keychain-backed secret store. For the default GitHub CI preset,
run:

```bash
switchboard auth github-ci
```

Paste the GitHub token and press Enter. The token value is not printed. For
scripts or custom `--secret-ref` values, use the lower-level command printed by
`switchboard add`:

```bash
switchboard secrets set <ref> --value-stdin
```

## 3. Check The Repo

```bash
switchboard doctor
switchboard secrets doctor
switchboard presets check github-ci --profile github_ci
```

`switchboard doctor` reports one top-level readiness status:

- `ok`: ready enough to use
- `setup-incomplete`: config is valid, but setup still needs action
- `failed`: a blocking issue must be fixed before use

The preset check starts the configured GitHub MCP server, discovers its
namespaced tools, and classifies them against the template's recommended
mandate policy. Treat `allowed_sensitive` as a signal to tighten the policy
before unattended work.

If a runtime command reports a missing `secretRef`, run the exact command it
prints:

```bash
switchboard secrets set <ref> --value-stdin
```

## 4. Connect A Client

Preview client config:

```bash
switchboard install codex
switchboard install claude
```

Write project-scoped config:

```bash
switchboard install codex --write
switchboard install claude --write
```

Every update to an existing client config creates a timestamped backup. Restore
one with:

```bash
switchboard install codex --rollback <backup>
switchboard install claude --rollback <backup>
```

The generated snippets run `switchboard --cwd <repo> mcp`, which auto-starts
the local daemon and routes MCP traffic through it.

## 5. Create A CI Mandate

Use the mandate command printed by `switchboard add github-ci`; it expands the
template's allow, deny, and approval policy, uses your current git branch, and
keeps the full policy inspectable in the created mandate.

```bash
switchboard mandate create --from github-ci
```

Then inspect the scoped tool surface:

```bash
switchboard tools --mandate fix-ci
switchboard tools --mandate fix-ci --json
```

## 6. Run The Agent Through The Mandate

For an agent client or harness, use the mandate-scoped endpoint:

```bash
switchboard mcp --mandate fix-ci
```

For approval-gated tools, either let the client use MCP elicitation when it is
available or approve from another terminal:

```bash
switchboard approvals --mandate fix-ci
switchboard approve <approval-id> --reason "CI rerun approved"
```

Use a bounded wait when the MCP client can tolerate pending calls:

```bash
switchboard mcp --mandate fix-ci --approval-wait 30s
```

## 7. Report And Handoff

```bash
switchboard logs --mandate fix-ci
switchboard mandate handoff fix-ci \
  --state completed \
  --summary "CI is green" \
  --next-step "merge after review" \
  --by implementer-agent
switchboard mandate report fix-ci --json
```

## Local Demo Without GitHub

To exercise the mandate approval path without a provider token, use the fixture
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
