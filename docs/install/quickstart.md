# Quickstart

Use this path to make one repo ready for a bounded GitHub CI agent task. The
flow is local-first: Switchboard writes repo config, stores provider tokens
behind `secretRef`s, installs a single local MCP endpoint into agent clients,
and creates mandates for task-scoped authority.

## 1. Add GitHub CI

Preview the setup plan:

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

## 2. Store The Token

Switchboard config stores only a printable `secretRef`; the token value goes
into the local keychain-backed secret store:

```bash
pbpaste | switchboard secrets set github/example/dev/token --value-stdin
```

Use the exact command printed by `switchboard add` if you customized
`--secret-ref`.

## 3. Check The Repo

```bash
switchboard doctor
switchboard secrets doctor
switchboard presets check github-ci --profile github_ci
```

The preset check starts the configured GitHub MCP server, discovers its
namespaced tools, and classifies them against the template's recommended
mandate policy. Treat `allowed_sensitive` as a signal to tighten the policy
before unattended work.

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
switchboard mandate create fix-ci --from github-ci --profiles github_ci
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
