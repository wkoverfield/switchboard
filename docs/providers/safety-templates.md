# Provider Safety Templates

Switchboard provider presets start as safety templates, not full vendor
integrations. A template prints value-free profile YAML, the local `secretRef`
setup command, and a recommended mandate policy for that provider shape.

Templates intentionally do not install, authenticate, or vendor a provider MCP
server. They assume the developer chooses the upstream MCP server command and
stores credentials through `switchboard secrets`.

## Commands

```bash
switchboard presets list
switchboard presets show github-ci
switchboard presets show vercel-preview --json
```

Customize rendered names without changing the safety posture:

```bash
switchboard presets show github-ci \
  --profile-name github_findu \
  --namespace "GitHub FindU" \
  --secret-ref github/findu/dev/token \
  --command npx \
  --arg -y \
  --arg @modelcontextprotocol/server-github
```

`--namespace` is normalized before it is used in recommended mandate policy, so
the example above renders policy for `github_findu_*` tools. Use repeatable
`--arg` for stdio servers that need command arguments; do not put a whole shell
command string into `--command`.

Then store the secret value locally:

```bash
pbpaste | switchboard secrets set github/findu/dev/token --value-stdin
```

The rendered YAML can be copied into `.switchboard.yaml`. It uses `{ secretRef }`
env values and never contains raw provider tokens.

## Included Templates

### `github-ci`

Purpose: inspect GitHub repository state and cautiously rerun CI under a mandate.

Default posture:

- provider: `github`
- profile: `github_ci`
- namespace: `github_ci`
- secret env: `GITHUB_TOKEN`
- default secretRef: `github/example/dev/token`
- mode: `guarded`
- enforcement: `switchboard`

Recommended mandate policy:

- allow namespaced GitHub tools for the task
- deny production deploy, delete, and admin-shaped tools
- require approval for rerun and merge-shaped tools

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

The next step is local dogfood with real upstream MCP commands and least
privilege tokens. Once the template policy holds up, Switchboard can promote the
most useful provider path into a real preset.
