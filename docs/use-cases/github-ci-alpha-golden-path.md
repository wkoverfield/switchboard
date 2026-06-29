# GitHub CI Alpha Golden Path

Audience: the first non-Wilson developer trying Switchboard in a real repo.

This path proves the core product promise in plain English: profile setup is
the front door, and the mandate is the bounded authority layer. The profile
connects this repo to the right GitHub MCP server and token without copying the
token into repo config. The mandate then gives one agent a temporary CI-fix
scope: current repo, current branch, GitHub CI tools, a lease, approvals for
sensitive actions, and an audit trail.

## Commands

Run these from the repo you want the agent to work in:

```bash
switchboard setup github-ci
switchboard doctor
switchboard presets check github-ci --profile github_ci
switchboard install codex --write
switchboard mandate create --from github-ci
switchboard mcp --mandate fix-ci
switchboard run --mandate fix-ci -- gh run list
switchboard mandate report fix-ci --json
```

Paste the GitHub token when `setup github-ci` prompts, then press Enter. The
token value is not printed.

## Practical CI-Fix Task Path

For a real CI-fix run, the useful shape is:

1. Ask the agent to inspect repository state, pull request context, workflow
   runs, and logs through the mandate-scoped GitHub tools.
2. Let it edit local code through its normal coding environment.
3. Use `switchboard run --mandate fix-ci -- gh run list` or a similar approved
   provider CLI command when the agent is operating in Code Mode instead of MCP.
4. Keep reruns, comments, PR updates, pushes, and merges approval-gated.
5. Deny delete/admin/repository-creation shaped tools.
6. End with `switchboard mandate report fix-ci --json` so the handoff includes
   mandate id, audit entries, approval requests, and readiness state.

The deterministic `pnpm smoke:github-ci-first-loop` proof covers that boundary:
read/check/log-like tools are allowed, rerun/comment/write-like tools create
approval requests before upstream execution, delete/admin/repository-creation
tools stay denied, approved and denied decisions appear in audit/report output,
and `switchboard run --mandate fix-ci -- ...` injects only mounted GitHub
profile env keys.

## Expected Checkpoints

After `switchboard setup github-ci`:

- `.switchboard.yaml` exists or is updated.
- The GitHub token is stored locally behind `secretRef`.
- Human output says setup is complete and prints the next commands.

After `switchboard add github-ci --write` in the manual flow:

- Human output summarizes the GitHub CI setup value before the YAML details.
- JSON output, when run with `--json`, includes `schemaVersion:
  "switchboard.provider-add.v1"` and structured `commands`.

After `switchboard doctor`:

- `ok` means the repo is ready enough to use.
- `setup-incomplete` means config is valid, but another setup command is still
  needed.
- `failed` means a blocking issue must be fixed first.
- If a secret is missing, the next action points to
  `switchboard auth github-ci` for the default preset or
  `switchboard secrets set <ref> --value-stdin` for custom refs.

After `switchboard presets check github-ci --profile github_ci`:

- The configured GitHub MCP server starts and lists namespaced tools.
- Tools are classified as allowed, approval-required, denied, or risky.
- Current live dogfood against GitHub's official MCP server observed 43 tools:
  26 allowed, 15 approval-required, 2 denied, 0 allowed-sensitive, and
  0 not-allowed. Counts can change when the upstream server changes.

After `switchboard mandate create --from github-ci`:

- The mandate id is `fix-ci`.
- The current git branch is used by default.
- The created mandate contains the template's allow, deny, and approval policy.
- With `--json`, the response includes `mcpLaunch` for a client or harness.

After `switchboard mcp --mandate fix-ci`:

- The local daemon starts when needed.
- Only the mandate-mounted profiles and policy-filtered tools are exposed.
- Approval-required tools remain visible, but execution is gated.
- Denied tools are hidden from normal tool lists and blocked if called directly.

After `switchboard run --mandate fix-ci -- gh run list`:

- Switchboard validates the mandate lease, repo, worktree, branch, profile, and
  secret readiness before launching the command.
- Only mounted profile `secretRef` values are injected as env vars.
- The command run is audited with mandate id, cwd, command, args, env key names,
  exit code, duration, and redacted output snippets.
- This is credential scoping plus audit, not a filesystem or network sandbox.

When an agent tries an approval-required tool:

- The call is blocked before the upstream provider runs.
- Switchboard creates a local approval request.
- The error points to the approval queue, exact approve/deny commands, and the
  original tool call to retry after approval.

Inspect the queue:

```bash
switchboard approvals --mandate fix-ci
```

Expected human output is a readable queue with the request id, status, mandate,
branch, tool, gate, risk, labels, reason, expiry, and next commands:

```bash
switchboard approve <approval-id> --reason "<why this is safe>"
switchboard deny <approval-id> --reason "<why this should not run>"
```

After approval, retry the original gated tool call from the agent. If the
request is expired or stale, retry the original gated call to create a fresh
approval request.

After `switchboard mandate report fix-ci --json`:

- The report uses `schemaVersion: "switchboard.mandate-report.v1"`.
- It includes readiness blockers, related approvals, audit entries, and
  handoff/result state for the mandate tree.
- GitHub CI approval-required, approved, denied, and Code Mode command-run
  evidence should be tied back to the mandate id.

## Common Failures

Missing secret:

```bash
switchboard setup github-ci
```

Use `switchboard auth github-ci` if the profile already exists and only the
token is missing. Use the exact lower-level `secrets set <ref> --value-stdin`
command printed by Switchboard if you customized `--secret-ref`.

Docker is not running:

Start Docker and retry. The default GitHub CI template runs GitHub's official
local MCP server with Docker.

`switchboard` is not on `PATH` from a source checkout:

Run `pnpm build`, then use the built CLI entrypoint or install/link the CLI for
the shell where your agent client runs. Harnesses can use `mcpLaunch` command
candidates when the installed binary is not available.

Branch mismatch:

The preset-backed mandate uses the current git branch by default. Pass
`--branch <branch>` when you need an explicit branch binding.

Allowed-sensitive tools:

Do not run unattended agent work until the policy is tightened. Either deny the
tool, require approval, or document why it is safe for this task.

## Ready Means

The repo is alpha-ready when:

- `switchboard doctor` is `ok` or only reports setup actions you understand.
- Required `secretRef`s are set locally.
- `switchboard presets check github-ci --profile github_ci` passes without
  unexpected risky tools.
- At least one client is installed, or a harness has the `mcpLaunch` payload.
- `switchboard mandate create --from github-ci --json` returns `mcpLaunch`.

That is enough for an alpha tester to hand a CI-fix agent scoped GitHub access
without handing it their whole developer environment.
