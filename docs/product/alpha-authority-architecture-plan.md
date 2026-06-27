# Alpha Authority Architecture Plan

Last updated: 2026-06-27

This plan turns the 2026-06-27 adversarial alpha evaluations into the next
implementation roadmap. The goal is to make Switchboard's public promise true
in practice:

> Find risky agent tool access in your repo and turn it into scoped, expiring,
> auditable authority.

The evaluated product is useful, but not yet hard to bypass. The next work
should make the authority boundary obvious, enforceable, and useful beyond MCP
alone.

## Product Diagnosis

The alpha has three validated jobs:

1. **Clean up MCP mess**
   Developers already have Codex/Claude MCP config, duplicated servers, inline
   env names, and sometimes raw secrets.

2. **Scope agent tool access**
   Developers want agents to use GitHub/Vercel/Stripe/Supabase-style tools
   without permanent, broad, prod-capable access.

3. **Control long agent runs**
   Harnesses and subagent systems need leases, launch contracts, approval
   queues, audit logs, and reports.

The main weaknesses are all boundary problems:

- direct MCP servers can remain beside Switchboard and bypass mandates
- code-mode/CLI execution can bypass MCP entirely
- harness launch payloads omit runtime/env isolation context
- runtime errors are not structured enough for loops
- risk findings are not visceral enough in `scan`, `doctor`, and import output

## Architecture Principle

Switchboard should be the local authority layer for agent tool access, not only
an MCP router.

MCP remains one execution mode:

```bash
switchboard mcp --mandate fix-ci
```

CLI/code mode should become another execution mode:

```bash
switchboard run --mandate fix-ci -- gh run list
switchboard run --mandate preview -- vercel logs
```

The shared primitive is the workspace lease:

```json
{
  "schemaVersion": "switchboard.workspace-lease.v1",
  "repo": {},
  "worktree": {},
  "branch": "main",
  "profiles": [],
  "authority": {},
  "limits": [],
  "mcpLaunch": {},
  "runLaunch": {},
  "audit": {}
}
```

The mandate remains the local persisted record. The workspace lease is the
portable contract that agents and harnesses consume.

## Phase 0: Patch Redaction Release

**Why first:** PR #107 fixed import redaction for token-like command args in
main, and `0.1.1` shipped that fix to npm. Keep this safety patch as the
release baseline before broader architecture work.

### Build

- Bump all published package versions together.
- Re-run package pack/install smokes and the published-package eval after
  publish.
- Revoke temporary npm publish tokens after release.

### Done Means

- Public npm package includes import arg redaction.
- `npm view` returns `0.1.1` for core, runtime, and CLI.
- `pnpm eval:published-alpha` passes against `@switchboard-mcp/cli@0.1.1`.

## Phase 1: Bypass Detection And Cleanup

**Why first:** all three evaluators found that direct MCP routes undercut the
core safety promise. If unsafe direct routes remain, Switchboard looks like an
optional wrapper rather than the authority boundary.

### Build

- Detect direct non-Switchboard MCP servers in Codex and Claude project config.
- Ship Bypass Findings V0 in `scan`, `doctor`, and import output before cleanup
  writes: unresolved direct routes appear as `bypassFindings`, human output gets
  an "Authority bypasses" section, and `doctor` fails the `direct-mcp-bypass`
  check instead of reporting `ok`.
- Mark direct routes as bypasses when Switchboard is also installed or when an
  import plan exists for those servers.
- Add risk findings for:
  - direct MCP server with broad filesystem path
  - direct MCP server with secret-looking env names
  - direct MCP server with token-like command args
  - direct MCP server whose provider matches an existing Switchboard profile
  - direct MCP server in the same client config as the `switchboard` server
  - filesystem MCP mounted at `/`, `$HOME`, repo parent directories, or other
    broad paths
- Extend import JSON with a cleanup section.
- Add `switchboard import --write --cleanup-client` after the plan is explicit
  and backup-protected.
- Preserve existing client config backups and rollback commands.

### Cleanup Semantics

Cleanup must be boring and reversible:

- Default cleanup mode is `disable`, not delete.
- For JSON MCP config, move disabled direct servers under a Switchboard-owned
  metadata section when the client format can preserve it safely; otherwise
  remove the server entry from active config and rely on the timestamped backup
  for rollback.
- For TOML MCP config, rewrite the active server list without direct bypasses
  and create a timestamped backup before writing.
- Every cleanup write returns:
  - `targetPath`
  - `backupPath`
  - removed/disabled server names
  - rollback command
  - accepted-risk instructions for intentional direct routes
- Re-running cleanup is idempotent: already-clean configs produce `noop`.
- Intentional direct routes require explicit acceptance, for example:

```bash
switchboard import --write --cleanup-client --accept-direct filesystem
```

Cleanup V0 ships backup-protected active-route removal and accepted-risk
guidance. Persistent accepted-risk config remains the next cleanup hardening
step.

Accepted direct routes remain visible in `doctor` as accepted risk, not `ok`
silence.

### User Output

The human output should show a before/after:

```text
Risky direct MCP routes:
- claude github: 43 tools, token env name, writes available
- claude filesystem: mounted at /, write tools likely

Switchboard can convert this to:
- one switchboard MCP endpoint
- github_stockr_ci profile behind secretRef
- filesystem direct route removed from client config
- fix-ci mandate with writes approval-gated
```

### JSON Contract

Add to scan/import/doctor JSON:

```json
{
  "bypassFindings": [
    {
      "client": "claude",
      "serverName": "github",
      "severity": "high",
      "reason": "direct MCP server bypasses Switchboard mandate policy",
      "recommendedAction": {
        "command": "switchboard",
        "args": ["import", "--write", "--cleanup-client"]
      }
    }
  ]
}
```

### Done Means

- `doctor` cannot report `ok` when direct unsafe MCP bypasses remain.
- `scan` and `import --dry-run` show exact bypass remediation.
- Cleanup writes are reversible with backups.
- Deterministic eval creates direct Claude/Codex MCP servers, installs
  Switchboard, and fails until bypasses are cleaned up.

## Phase 2: Code-Mode / CLI Authority

**Why second:** many coding agents will use shell commands, generated JS, SDKs,
or provider CLIs instead of MCP. Switchboard loses relevance if it only governs
MCP.

### Build

Add:

```bash
switchboard run --mandate <id> -- <command> [...args]
```

Initial behavior:

- load mandate and verify lease, repo, worktree, branch, handoff state, and
  missing secret refs
- run from mandate worktree unless `--cwd` overrides within the repo boundary
- inject only env vars from mounted profiles' `secretRef` entries
- redact secret-like stdout/stderr snippets before audit storage
- audit command, args, cwd, env key names, exit code, duration, mandate id, and
  profile refs
- return nonzero with `switchboard.error.v1` JSON when `--json` is used

Defer full command sandboxing. Be explicit:

> `switchboard run` scopes credentials and audits command execution; it is not a
> filesystem/network sandbox.

### Policy V0

Start narrow and explicit. V0 should support provider command classes, not
arbitrary shell policy.

- Supported binaries in V0:
  - `gh`
  - `vercel`
  - `stripe`
  - fixture CLI used by tests
- Read-only allow examples:
  - `gh run list`, `gh run view`, `gh pr view`, `gh issue view`
  - `vercel logs`, `vercel inspect`, `vercel project ls`
  - `stripe * list`, `stripe * retrieve` under test-mode profile
- Approval-required examples:
  - `gh run rerun`, `gh pr comment`, `gh issue comment`
  - `vercel deploy`, `vercel rollback`
  - Stripe test-mode create/update/refund-like commands
- Denied examples:
  - prod deploy/promote/delete commands where detectable
  - live Stripe key/profile usage under `stripe-test`
  - destructive database/provider admin commands once database providers exist
- Shell wrappers are `unclassified` by default:
  - `bash -c`
  - `sh -c`
  - `node script.js`
  - `pnpm run ...`
  - `npm run ...`
- Unclassified commands are denied unless the mandate explicitly allows them or
  the user passes an intentional escape hatch such as
  `--allow-unclassified-command`.
- Audit stdout/stderr is size-limited and redacted. Store full command metadata,
  but cap captured output to a documented byte limit.
- Approval-required commands create the same local approval request primitive as
  MCP tool calls.

### JSON Contract

Add to workspace lease:

```json
{
  "runLaunch": {
    "schemaVersion": "switchboard.run-launch.v1",
    "command": "switchboard",
    "args": ["run", "--mandate", "fix-ci", "--"],
    "env": {
      "XDG_STATE_HOME": "...",
      "XDG_CONFIG_HOME": "..."
    }
  }
}
```

### Done Means

- `switchboard run --mandate fix-ci -- env` exposes only expected provider env
  keys and no raw secrets in output/audit.
- `switchboard run` refuses expired, wrong-branch, missing-secret, and closed
  handoff mandates.
- A harness can choose MCP or run mode from the same workspace lease.
- Eval proves a direct `gh`/fixture CLI path can be routed through Switchboard.

## Phase 3: Recommended Next Action

**Why third:** once bypass cleanup and run mode make the boundary more real, the
product should make the next step obvious. Humans need one recommendation,
while agents/harnesses need structured alternatives.

### Build

- Add a planner function in core that ranks repo state into one recommended
  next action.
- Surface it in `scan`, `doctor`, and import output.
- Optional command:

```bash
switchboard next
switchboard next --json
```

### Decision Order

1. Fix invalid config.
2. Store missing secret refs.
3. Clean direct bypasses.
4. Install Switchboard client route.
5. Create mandate from best configured preset/profile.
6. Launch MCP or run a command under the mandate.
7. Produce report/handoff.

### Done Means

- A clean npm-installed repo can reach the correct next action in one command.
- No human flow prints multiple equally weighted commands without a primary
  recommendation.
- Fresh-agent eval checks that the first three commands produce a concrete aha:
  `scan`, `import --dry-run` or `setup`, then the recommended next action.

## Phase 4: Harness Launch Hardening

**Why fourth:** advanced users validated `workspaceLease`, but need richer
launch context and machine-readable errors to build control loops.

### Build

- Include runtime/state/config launch context in `workspaceLease.mcpLaunch`:
  - `runtimeDir`
  - `XDG_STATE_HOME`
  - `XDG_CONFIG_HOME`
  - `SWITCHBOARD_RUNTIME_DIR`
  - approval wait defaults
  - daemon isolation strategy
- Add stable structured MCP error data for:
  - denied tool
  - approval required
  - approval denied
  - expired mandate
  - wrong branch/worktree
  - missing secret ref
- Add optional heartbeat/status surfaces:

```bash
switchboard mandate heartbeat <id> --json
switchboard mandate status <id> --json
```

### Error Shape

```json
{
  "schemaVersion": "switchboard.mcp-error.v1",
  "code": "approval_required",
  "mandateId": "fix-ci",
  "approvalRequestId": "approval-1",
  "nextActions": [
    {
      "command": "switchboard",
      "args": ["approve", "approval-1"]
    }
  ]
}
```

### Contract Versioning

- Keep `switchboard.workspace-lease.v1` backward compatible for additive fields.
- Add `workspaceLease.capabilities` so harnesses can detect optional support:
  - `mcpLaunch.env`
  - `runLaunch`
  - `structuredMcpErrors`
  - `heartbeat`
- Only introduce `switchboard.workspace-lease.v2` if required fields or existing
  meanings change.
- Structured MCP error payloads use their own schema version:
  `switchboard.mcp-error.v1`.

### Done Means

- Harness smoke launches MCP from `workspaceLease.mcpLaunch` without manually
  inventing runtime dirs.
- Approval-required errors expose approval ids in structured data.
- Expired/denied/missing-secret paths are machine-readable and documented.

## Phase 5: Risk Classification Polish

**Why fifth:** this is what makes the marketing visceral. Developers should see
the risk before they learn Switchboard vocabulary.

### Build

- Add risk classifications to import/scan findings:
  - `prod_env_hint`
  - `live_payment_key_hint`
  - `database_write_surface`
  - `provider_admin_surface`
- Add severity: `info`, `medium`, `high`, `critical`.
- Add plain-English reasons and exact next actions.
- Make `mandate create --from <preset>` adapt to imported profile names when
  only one matching provider/profile exists.

### Done Means

- A repo with filesystem MCP mounted at `/` produces a high or critical warning.
- A repo with Stripe live-looking env names cannot silently use `stripe-test`.
- A repo with one imported GitHub profile gets a working preset-backed mandate
  command without requiring profile-name guessing.

## Phase 6: Provider Proof, Not Provider Breadth

**Why later:** provider breadth is only useful after the authority boundary is
credible.

### Build

1. Real Stripe test-mode dogfood:
   - use restricted test key
   - discover real tool names
   - classify payment/refund/customer/webhook-secret tools
   - prove denied/gated calls and audit entries
2. Supabase dev design/proof:
   - no prod writes by default
   - database/schema/migration/storage policies
   - clear stance on data reads and PII
3. Optional Sentry/PostHog readonly templates after the money/database stories.

### Done Means

- Provider docs are based on observed tool surfaces, not only imagined patterns.
- Dangerous provider calls are blocked or approval-gated in a black-box smoke.
- Token values never appear in CLI output, MCP responses, audit logs, reports,
  or eval transcripts.

## Release Plan

### Patch Release

Publish a patch after the import arg redaction fix:

```bash
npm version patch --workspaces=false
pnpm build
pnpm test
pnpm lint
pnpm -r typecheck
pnpm smoke:package-pack
pnpm smoke:package-install
pnpm release:npm-alpha:preflight
```

Then publish `core`, `mcp-runtime`, and `cli` in order.

### Alpha Launch Gate

Do not broaden launch until:

- bypass detection is visible in `scan` and `doctor`
- direct client cleanup is backup-protected
- one code-mode/CLI authority path exists or is explicitly caveated
- published package eval passes
- three adversarial agents re-run and no P0 trust break remains
- one non-Wilson human reaches the aha from npm install

## Proposed PR Slices

1. **Patch Redaction Release**
   - version bump
   - package preflight
   - publish patched core/runtime/CLI
   - verify `eval:published-alpha`

2. **Bypass Findings V0**
   - scan/doctor/import JSON and human output
   - direct MCP bypass severity
   - filesystem root/broad-path severity
   - token-like arg/env severity
   - eval fixture

3. **Cleanup Plan V0**
   - dry-run cleanup actions
   - `--cleanup-client` write path with backups
   - rollback docs
   - accepted-risk path

4. **Run Mode V0**
   - `switchboard run --mandate`
   - scoped env injection
   - audit/redaction
   - mandate readiness checks
   - narrow provider command policy

5. **Recommended Next Action**
   - core planner
   - `switchboard next`
   - scan/doctor/import integration

6. **WorkspaceLease Launch V2**
   - richer `mcpLaunch`
   - `runLaunch`
   - structured MCP error data
   - capabilities/versioning

7. **Provider Proof**
   - Stripe test live dogfood
   - Supabase dev design or fixture proof

## Marketable Golden Path

The next demo should be:

```bash
npm install -g @switchboard-mcp/cli
switchboard scan
switchboard import --dry-run
switchboard import --write --cleanup-client
switchboard mandate create --from github-ci --json
switchboard run --mandate fix-ci -- gh run list
switchboard logs --mandate fix-ci
```

The story should be visible in output:

```text
Before: direct GitHub MCP route with token env and write tools.
After: Switchboard route, token behind secretRef, fix-ci lease, gh run list
audited under mandate.
```

This order maximizes user trust before expanding provider surface area.
