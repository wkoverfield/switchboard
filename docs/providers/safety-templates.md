# Provider Safety Templates

Switchboard provider presets start as safety templates, not full vendor
integrations. A template prints value-free profile YAML, the local `secretRef`
setup command, and a recommended mandate policy for that provider shape.

Templates intentionally do not install, authenticate, or vendor a provider MCP
server. They assume the developer chooses the upstream MCP server command and
stores credentials through `switchboard secrets`.

## Commands

```bash
switchboard add github-ci
switchboard add github-ci --write
switchboard presets list
switchboard presets show github-ci
switchboard presets show vercel-preview --json
switchboard presets check github-ci --profile github_findu
```

`switchboard add` is the guided setup surface. It prints a transparent plan by
default and writes `.switchboard.yaml` only with `--write`. The plan includes
the profile config, `secretRef` setup command, provider check command,
Codex/Claude install commands, and recommended mandate command.

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
writing anything:

```bash
switchboard presets show github-ci --json
```

Then store the secret value locally:

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

Dogfood result, 2026-06-23: the default template was checked against the
official GitHub MCP Docker server using a real GitHub token. The server exposed
43 namespaced tools. The template classified 26 as allowed, 15 as approval
required, 2 as denied, 0 as allowed-sensitive, and 0 as not-allowed. Denied
tools were repository creation and file deletion. Approval-gated examples
included comments, Copilot assignment, branch/file/PR creation, issue writes,
PR review writes, pushes, updates, and merge.

### `vercel-preview`

Purpose: inspect preview deployment/log state while production-impacting actions
stay denied or approval-gated.

Default posture:

- provider: `vercel`
- profile: `vercel_preview`
- namespace: `vercel_preview`
- secret env: `VERCEL_TOKEN`
- default secretRef: `vercel/example/preview/token`
- mode: `guarded`
- enforcement: `switchboard`

Recommended mandate policy:

- allow namespaced Vercel preview tools for the task
- deny production deploy, promotion, env, and domain-shaped tools
- require approval for deploy and rollback-shaped tools

## Why This Comes Before Full Presets

The market wedge is repo-aware provider setup, but full presets become dangerous
if they arrive before secretRefs, mandate scope, approval gates, and audit are
real. Safety templates let us dogfood provider-shaped workflows now while
keeping claims modest:

- no OAuth
- no hosted broker
- no raw provider tokens in config
- no automatic provider MCP install
- no claim that provider-specific permissions are fully enforced

The next step is local dogfood with the official GitHub MCP server and
least-privilege tokens. Once the template policy holds up against observed tool
names, Switchboard can promote the most useful provider path into a real preset.
