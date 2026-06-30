# Provider Safety Templates

Switchboard provider presets start as safety templates, not full vendor
integrations. A template prints value-free profile YAML, the local `secretRef`
setup command, and a recommended mandate policy for that provider shape.

Templates intentionally do not install or vendor a provider MCP server. They
assume the developer chooses the upstream MCP server command and stores
credentials through `switchboard auth <preset>` or the lower-level
`switchboard secrets` primitives.

## Commands

```bash
switchboard add github-ci
switchboard add github-ci --write
switchboard setup github-ci
switchboard auth github-ci
switchboard presets list
switchboard presets show github-ci
switchboard presets show vercel-preview --json
switchboard presets show supabase-dev --json
switchboard presets check github-ci --profile github_findu
```

`switchboard setup` is the human happy path: it writes `.switchboard.yaml` and
stores the provider token in one guided flow. `switchboard add` is the
transparent planning surface. It prints a plan by default and writes only with
`--write`. The plan includes
the profile config, provider auth command, lower-level `secretRef` setup
command, provider check command, Codex/Claude install commands, recommended
mandate command, and credential guidance for least-privilege dogfood.

Customize rendered names without changing the safety posture:

```bash
switchboard add github-ci \
  --profile-name github_findu \
  --namespace "GitHub FindU" \
  --secret-ref github/findu/dev/token \
  --write
```

`--namespace` is normalized before it is used in recommended mandate policy, so
the example above renders policy for `github_findu_*` tools. Use repeatable
`--arg` for stdio servers that need command arguments; do not put a whole shell
command string into `--command`.

`presets show` remains available when you only want value-free YAML without
writing anything. JSON output also includes `mandatePolicy`, the rendered
allow/deny/approval-gate policy for the selected namespace:

```bash
switchboard presets show github-ci --json
```

Then store the token value locally:

```bash
switchboard auth github-ci
```

For custom refs or scripts, keep using the lower-level primitive:

```bash
pbpaste | switchboard secrets set github/findu/dev/token --value-stdin
```

The rendered YAML can be copied into `.switchboard.yaml`. It uses `{ secretRef }`
env values and never contains raw provider tokens.

After the profile is configured and the upstream MCP server can start, run a
template check:

```bash
switchboard presets check github-ci --profile github_findu --json
```

The check discovers the configured profile's actual namespaced tools and
classifies them against the template's recommended mandate policy:

- `allowed`: covered by the allow list
- `approval_required`: matched by an approval gate
- `denied`: matched by a deny rule
- `not_allowed`: outside the template allow list, often a namespace mismatch
- `allowed_sensitive`: write-like or privileged-looking tool name that is
  currently allowed without an explicit deny or approval gate

Treat `allowed_sensitive` as a dogfood signal. Tighten the template policy or
create a narrower mandate before using that provider profile for unattended
agent work.

An `ok` or `policy-covered` result means the discovered tools are covered by the
template's recommended mandate policy. It does not make direct, unmandated use
of the profile safe. Use the profile through a mandate so Switchboard can apply
the rendered allow, deny, and approval rules.

For live-provider testing, use `docs/use-cases/provider-dogfood-runbook.md`.
The runbook keeps GitHub CI as the primary proof and Vercel Preview as the
second proof before adding more providers.

## Included Templates

### `github-ci`

Purpose: inspect GitHub repository state and cautiously rerun CI under a mandate.

Default posture:

- provider: `github`
- profile: `github_ci`
- namespace: `github_ci`
- secret env: `GITHUB_PERSONAL_ACCESS_TOKEN`
- default secretRef: `github/example/dev/token`
- mode: `guarded`
- enforcement: `switchboard`

Recommended mandate policy:

- allow namespaced GitHub tools for the task
- deny production deploy, delete, admin-shaped tools, and repository creation
- require approval for comments/replies, Copilot assignment, create/update/write
  operations, forks, pushes, reruns, and merges

Credential guidance:

- minimum access: repository metadata, pull requests, checks/statuses, and
  workflow runs/logs
- add only when approval-gated: workflow reruns, PR comments/reviews, branch
  pushes, and PR updates
- avoid: org admin, repository deletion, repository creation, and production
  deployment credentials

Dogfood result, 2026-06-23: the default template was checked against the
official GitHub MCP Docker server using a real GitHub token. The server exposed
43 namespaced tools. The template classified 26 as allowed, 15 as approval
required, 2 as denied, 0 as allowed-sensitive, and 0 as not-allowed. Denied
tools were repository creation and file deletion. Approval-gated examples
included comments, Copilot assignment, branch/file/PR creation, issue writes,
PR review writes, pushes, updates, and merge.

Deterministic alpha proof now also exercises GitHub CI through both authority
paths: mandate-scoped MCP routing and Code Mode-style command execution under
`switchboard run --mandate fix-ci -- ...`. `pnpm smoke:github-ci-first-loop`
uses a GitHub-shaped fixture surface to prove that read/check/log-like tools are
allowed, rerun/comment/write-like tools create approval requests before upstream
execution, delete/admin/repository-creation tools stay denied, approved and
denied decisions appear in audit/report output, and run mode injects only the
mounted GitHub profile secretRef env key.

### `vercel-preview`

Purpose: inspect preview deployment/log state while production-impacting actions
stay denied or approval-gated.

Default posture:

- provider: `vercel`
- profile: `vercel_preview`
- namespace: `vercel_preview`
- secret env: `VERCEL_TOKEN`
- default secretRef: `vercel/example/preview/token`
- default command: `npx -y vercel-platform-mcp-server`
- default extra env: `VERCEL_ENABLED_TOOLGROUPS=readonly`
- mode: `guarded`
- enforcement: `switchboard`

Recommended mandate policy:

- allow namespaced Vercel preview tools for the task
- deny production deploy, promotion, env/environment, domain, secret/token,
  billing, and team-shaped tools
- require approval for deployment write and rollback-shaped tools

Credential guidance:

- minimum access: project metadata, deployments, and build/runtime logs
- add only when approval-gated: preview deploy and rollback
- avoid: production promotion, environment variable writes, domain management,
  team administration, and billing administration

Dogfood result, 2026-06-25: the default template was checked against
`vercel-platform-mcp-server` using a real Vercel CLI token copied into a
Switchboard `secretRef`. With `VERCEL_ENABLED_TOOLGROUPS=readonly`, the server
exposed 5 namespaced tools. The template classified all 5 as allowed, with 0
allowed-sensitive, 0 approval-required, 0 denied, and 0 not-allowed. A
mandate-scoped MCP session successfully called `vercel_preview_list_projects`
without printing token values.

Deterministic alpha proof now also exercises the Vercel Preview authority
boundary without live credentials. `pnpm smoke:vercel-preview-dogfood` uses a
Vercel-shaped fixture surface to prove preview read/log tools are allowed,
deployment create/rollback tools create approval requests before upstream
execution, production deploy/admin/env/domain/token/billing/team-shaped tools
stay denied, approved and denied decisions appear in audit/report output, and
`switchboard run --mandate inspect-preview -- ...` injects only the mounted
Vercel profile `secretRef` env key.

### `supabase-dev`

Purpose: inspect development database/project state while destructive,
production, admin, service-role, and secret/token-shaped actions stay denied or
approval-gated.

Default posture:

- provider: `supabase`
- profile: `supabase_dev`
- namespace: `supabase_dev`
- secret env: `SUPABASE_ACCESS_TOKEN`
- default secretRef: `supabase/example/dev/access-token`
- default command: `npx -y @supabase/mcp-server-supabase@latest --read-only`
- mode: `guarded`
- enforcement: `switchboard`

The default command is intentionally only a read-only starting point. Live
dogfood must use a development project token and add upstream project scoping
when the Supabase MCP server supports it; Switchboard cannot prove a token is
development-only from tool names alone.

Recommended mandate policy:

- allow namespaced Supabase dev inspection tools for the task
- deny production, service-role, admin, root, destructive data/schema,
  secret/token, and credential-shaped tools
- require approval for arbitrary SQL, migrations, create/insert/update/upsert,
  and configuration-setting tools

Credential guidance:

- minimum access: development project metadata, schemas/tables, logs, and query
  plans
- rejected by guided setup/auth: obvious production, live, admin, root, or
  `service_role`-looking values
- add only when approval-gated: arbitrary SQL, development migrations, and
  development row writes
- avoid: production project access, `service_role` keys, project admin tokens,
  and destructive database privileges

Deterministic alpha proof exercises the Supabase Dev authority pattern without
live credentials. `pnpm smoke:supabase-dev-dogfood` uses a Supabase-shaped
fixture surface to prove read/list/query/log tools are allowed, arbitrary SQL
and migration tools create approval requests before upstream execution,
destructive/prod/admin/service-role/token-shaped tools stay denied, approved
and denied decisions appear in audit/report output, and
`switchboard run --mandate inspect-dev-db -- ...` injects only the mounted
Supabase profile `secretRef` env key.

## Why This Comes Before Full Presets

The market wedge is repo-aware provider setup, but full presets become dangerous
if they arrive before secretRefs, mandate scope, approval gates, and audit are
real. Safety templates let us dogfood provider-shaped workflows now while
keeping claims modest:

- no OAuth
- no hosted broker
- no raw provider tokens in config
- no vendored provider MCP server
- no claim that provider-specific permissions are fully enforced

The first live GitHub MCP server dogfood has held up against observed tool
names. The first live Vercel Preview dogfood has held up for readonly project
and deployment/log inspection, and fixture proof now covers the core Vercel
Preview authority pattern. The remaining live provider proof is to repeat
GitHub CI with a dedicated least-privilege token, rerun Vercel Preview with a
project-scoped token/report, and add Stripe test-mode proof once an
MCP-authorized restricted test key is available. Supabase Dev now has fixture
proof for the database-shaped authority pattern, but still needs live
development-project dogfood before any production-facing claims. Once those
reports stay policy-covered, Switchboard can promote the most useful provider
path into a real preset.
