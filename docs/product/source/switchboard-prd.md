# Switchboard PRD

Status: Decision-complete draft v0.2  
Date: 2026-06-18  
Owner: Wilson Overfield  
Working name: Switchboard

## Summary

Switchboard is a local-first MCP profile router for developers.

Developers increasingly use agents like Codex, Claude Code, Cursor, VS Code agents, and Windsurf to operate real tools. Those tools are usually exposed through MCP servers. But real development work is multi-account, multi-project, multi-org, and multi-environment. A developer may have Supabase dev/prod projects, Stripe test/live accounts, PostHog staging/prod projects, Sentry personal/work accounts, multiple GitHub orgs, and client-specific tools.

Today, every agent host has its own MCP config. Provider MCPs often assume one authenticated account/project. Tool names collide. Agents cannot reliably tell dev from prod. Credentials are scattered. The developer has no simple answer to: "What account is this agent about to touch?"

Switchboard gives developers one local MCP endpoint that every agent connects to. Behind that endpoint, Switchboard manages profiles, accounts, projects, environments, namespaces, policies, and audit logs.

## One-Liner

One local MCP endpoint for every account, project, and environment.

## Product Thesis

The MCP ecosystem will have many registries, gateways, provider MCPs, hosted integration platforms, and runtime managers. Developers still need a local control layer that answers:

- Which account/project/environment does this repo use?
- Which tools should this agent see right now?
- Is prod/live read-only?
- What did the agent just do?
- Can I use the same setup across Codex, Claude Code, Cursor, and VS Code?

Switchboard should own that layer.

It should not become a generic agent platform, a 1,000-app connector marketplace, or an enterprise gateway first. It should be the developer-loved profile router above the ecosystem.

## Target Users

### Primary User

Individual developer or technical founder using AI coding agents daily.

Characteristics:
- Works across multiple repos.
- Uses multiple SaaS tools and cloud providers.
- Has dev/staging/prod environments.
- Uses more than one AI client.
- Wants agents to access real tools without risking prod accidents.
- Is comfortable with CLI-first workflows.

Examples:
- Wilson building FindU across Supabase/Convex/GitHub/Vercel/PostHog/Sentry/Stripe.
- Indie hacker with test/live Stripe and dev/prod Supabase.
- Agency developer working across multiple client SaaS accounts.
- Startup engineer using Claude Code and Cursor against the same stack.

### Secondary User

Small engineering team.

Characteristics:
- Wants shared profile templates and team policies.
- Does not want every developer hand-editing MCP JSON.
- Needs auditability for agent actions.
- Wants production guardrails but not enterprise ceremony.

### Later User

Platform/security team.

Characteristics:
- Needs central audit, SSO, approval flows, policy packs, managed secrets, and remote gateway mode.
- This should be a later expansion, not the v1 center.

## Problem

MCP makes tools available to agents, but it does not yet make real developer environments manageable.

Specific problems:

1. **Provider MCPs often assume one account/project**
   - Supabase project/org targeting is awkward.
   - Stripe MCP has public demand for multiple accounts.
   - PostHog project switching conflicts with scoped API keys.
   - Sentry users have asked for profiles for personal/work accounts.

2. **Agent configs are duplicated**
   - Codex, Claude Code, Cursor, VS Code, and other clients all have their own MCP config formats.
   - Developers repeat the same setup everywhere.

3. **Tool names collide**
   - Different MCP servers expose tools with the same name.
   - Same provider instances for dev/prod expose identical tools.
   - The model or client may route by tool name instead of human server label.

4. **Environment safety is weak**
   - Prod/live access can look exactly like dev/test.
   - Read-only and destructive-action controls are inconsistent.
   - Prompt instructions are not enough.

5. **Credentials are scattered**
   - Secrets end up in JSON files, environment variables, shell profiles, or one-off client config.
   - Developers need a commit-safe config with local-only secrets.

6. **Observability is poor**
   - It is hard to answer what an agent called, with which account, against which environment, and whether it succeeded.

## Goals

### Product Goals

- Give developers one MCP endpoint for all agents.
- Make account/project/environment targeting explicit and visible.
- Support multiple profiles per provider.
- Prevent tool-name collisions through namespacing.
- Make prod/live environments safer by default.
- Support different developer operating styles, from read-only inspection to intentionally write-enabled agent sessions.
- Provide human-readable audit logs.
- Work across popular agent clients.
- Integrate with existing MCP ecosystems instead of replacing them.
- Make onboarding feel guided, fast, and reversible, with a first useful agent tool call in under five minutes.
- Make Switchboard discoverable and recommendable by coding agents when developers hit MCP account/project/environment pain.

### User Goals

Users should be able to:
- Add profiles for Supabase, Stripe, PostHog, Sentry, GitHub, Vercel, Linear, and generic MCP servers.
- Link profiles to a local repo/workspace.
- Generate client configs for Codex, Claude Code, Cursor, and VS Code.
- See which profiles are active for the current repo.
- Run agents without worrying which project/account is connected.
- Inspect logs after an agent session.
- Keep production/live access read-only unless explicitly unlocked.
- Deliberately unlock write-capable profiles when they want an agent to operate with more autonomy.
- Get from install to working Switchboard without understanding MCP transports, config formats, or YAML.

### Business/Open-Source Goals

- Build trust with a complete local-first open-source core.
- Become a default utility for MCP-heavy developers.
- Expand later into team policies, shared configs, central audit, and managed remote endpoints.

## Non-Goals

Switchboard v1 should not:
- Be an AI agent or chat interface.
- Replace Codex, Claude Code, Cursor, or VS Code.
- Become a broad 1,000-app connector platform.
- Require a cloud account.
- Require a GUI.
- Own every provider integration directly.
- Become enterprise-first gateway software.
- Hide configuration behind opaque magic.

## Workflow Personas

Switchboard should serve several modern developer workflows:

- **AI-native solo founder:** hops between Codex, Claude Code, Cursor, and SaaS tools; needs instant setup, import, and high-agency modes.
- **Startup full-stack engineer:** uses GitHub, Vercel, Supabase, Stripe, PostHog, and Sentry across local/preview/staging/prod.
- **Agency/client-work developer:** needs hard client/workspace separation and no accidental cross-client tool calls.
- **Enterprise/platform engineer:** needs policy, audit, approved runtime options, secret hygiene, and team rollout later.
- **Data/analytics engineer:** wants safe read-heavy production access, query guardrails, and analytics/project switching.
- **Backend/mobile/frontend developer:** needs provider-specific quickstarts by job, not only generic MCP docs.
- **High-agency agent user:** wants `autopilot` or `unrestricted` sessions for trusted dev/staging workflows without the product feeling read-only-only.

These personas should shape docs, onboarding prompts, examples, and launch content.

## Positioning

Primary:

> One local MCP endpoint for every account, project, and environment.

Alternate:

> The local profile router for MCP.

Avoid:

> An MCP gateway.

Why avoid "gateway":
- Crowded term.
- Sounds enterprise.
- Emphasizes infrastructure over developer workflow.

## Core Concepts

### Profile

A configured connection to one provider target.

Examples:
- `supabase_findu_dev`
- `supabase_findu_prod`
- `stripe_findu_test`
- `stripe_findu_live`
- `posthog_findu_prod`
- `sentry_findu_ios`
- `github_findu`
- `vercel_findu`

Each profile includes:
- Provider.
- Account/org/team/project identifiers.
- Environment.
- Namespace.
- Auth reference.
- Permissions/policy.
- Upstream MCP transport.

### Workspace

A local repo or folder associated with profiles.

Example:

```yaml
workspaces:
  findu:
    paths:
      - ~/Documents/GitHub/findu
      - ~/Documents/FindU
    profiles:
      - supabase_findu_dev
      - supabase_findu_prod
      - stripe_findu_test
      - stripe_findu_live
      - posthog_findu_prod
      - sentry_findu_ios
      - github_findu
      - vercel_findu
    defaultEnvironment: development
```

### Environment

A safety/routing label.

Built-in values:
- local
- development
- staging
- production
- test
- live
- personal
- client

### Namespace

The prefix Switchboard applies to upstream tool names.

Examples:
- `supabase_findu_dev_query`
- `stripe_findu_live_list_customers`
- `posthog_findu_prod_query_insights`
- `sentry_findu_ios_list_issues`
- `github_findu_create_issue`

### Policy

Rules that determine visibility, blocking, and confirmation.

Examples:
- Prod is read-only by default.
- Stripe live writes require confirmation.
- Postgres `DROP` is blocked.
- GitHub branch deletion requires confirmation.
- PostHog feature flag edits require confirmation.

### Operating Mode

The profile/session posture that controls how much agency the user gives the agent.

Switchboard is not a read-only-only product. It should support developers who want cautious inspection, developers who want guarded write access, and developers who intentionally want to "release the claw" for trusted workflows.

Built-in modes:

- `inspect`: read-only tools only.
- `guarded`: writes allowed, but risky actions require confirmation.
- `autopilot`: writes allowed for the current session according to policy; destructive/live/money actions may still require confirmation.
- `unrestricted`: expose write-capable tools with minimal Switchboard gating; requires explicit opt-in, is never the default for production/live/money-moving profiles, and is loudly logged.

Examples:

```bash
switchboard session --mode inspect
switchboard session --mode guarded
switchboard session --mode autopilot --profiles supabase_findu_dev,github_findu
switchboard session --mode unrestricted --profiles supabase_findu_dev --ttl 30m
```

The product should make stronger modes easy to choose but hard to enter accidentally.

### Session

The active tool exposure context for one agent run.

Sessions can be:
- Workspace-derived.
- Explicitly selected.
- Temporarily narrowed.

Example:

```bash
switchboard session --profiles supabase_findu_dev,github_findu
```

## Ideal User Experience

### Install

```bash
npm install -g @switchboard-mcp/cli
switchboard init
```

`switchboard init` should feel like a guided setup, not a blank config generator.

Example first-run flow:

```text
Welcome to Switchboard.

Detected:
  Agent clients: Codex, Claude Code
  Current repo: findu
  Existing MCP configs: Supabase in Claude Code, GitHub in Codex

What do you want to set up first?
  1. Connect one provider and test it
  2. Import existing MCP configs
  3. Link this repo to profiles
  4. Advanced/manual setup

Recommended: Connect one provider and test it.
```

The golden path should be:

```bash
npm install -g @switchboard-mcp/cli
switchboard init
switchboard add supabase findu-dev
switchboard install codex --write
switchboard doctor
switchboard test supabase_findu_dev
```

Success output:

```text
Switchboard is ready.

Agent: Codex
Workspace: findu
Profile: supabase_findu_dev
Tools: 18 discovered
Safety: guarded

Try this in Codex:
  Use Switchboard to list the Supabase tables for this repo.
```

### Add Profiles

```bash
switchboard add supabase findu-dev
switchboard add supabase findu-prod --read-only --confirm writes
switchboard add stripe findu-test --mode test
switchboard add stripe findu-live --mode live --read-only --confirm money
switchboard add posthog findu-prod --project-id 12345 --read-only
switchboard add sentry findu-ios --org findu --project ios --read-only
switchboard add github findu --org findu-ai
switchboard add vercel findu --team findu
switchboard add linear findu --workspace findu
```

Developers can also create write-enabled profiles intentionally:

```bash
switchboard add supabase findu-dev --mode development --read-write
switchboard add posthog findu-staging --project-id 67890 --read-write --confirm settings
switchboard add stripe findu-test --mode test --read-write
```

### Link Workspace

```bash
cd ~/Documents/GitHub/findu
switchboard link
```

Output:

```text
Linked workspace: findu

Active profiles:
  supabase_findu_dev       development   read/write
  supabase_findu_prod      production    read-only enforced: provider read-only flag
  stripe_findu_test        test          read/write
  stripe_findu_live        live          read-only enforced: restricted key
  posthog_findu_prod       production    read-only enforced: readonly session + project pin
  sentry_findu_ios         production    read-only enforced: scoped session
  github_findu             production    limited
  vercel_findu             production    confirm deploys

Default write target: development
```

For a trusted local/dev workflow:

```bash
switchboard session --mode autopilot --profiles supabase_findu_dev,github_findu
```

For an intentionally high-agency session:

```bash
switchboard session --mode unrestricted --profiles supabase_findu_dev --ttl 30m
```

Output:

```text
Unrestricted session started for 30m.

Profiles:
  supabase_findu_dev       development   read/write

Production, live, and money-moving profiles remain excluded unless named explicitly.
All tool calls will be audit logged.
```

### Configure Agents

```bash
switchboard install codex --write
switchboard install claude --write
switchboard install cursor --write
switchboard install vscode --write
```

Each client points to one local MCP server:

```json
{
  "mcpServers": {
    "switchboard": {
      "command": "switchboard",
      "args": ["mcp"]
    }
  }
}
```

### Use With An Agent

Prompt:

```text
Use Switchboard to compare dev and prod Supabase schemas. Do not write to prod.
```

Agent sees:

```text
supabase_findu_dev_list_tables
supabase_findu_dev_query
supabase_findu_prod_list_tables
supabase_findu_prod_query
```

If it tries a prod write:

```text
Blocked by Switchboard: supabase_findu_prod is read-only.
```

If it tries a live Stripe action:

```text
Approval required:

Profile: stripe_findu_live
Tool: create_refund
Environment: live
Amount: $49.00

Approve with `switchboard approve apr_123` or deny with `switchboard approve apr_123 --deny`.
Timeout: 60s. Default: deny.
```

### Inspect Logs

```bash
switchboard logs --since 1h
```

Output:

```text
11:41:03  codex  supabase_findu_dev.query              ok       212ms
11:41:10  codex  supabase_findu_prod.apply_migration   blocked  read-only
11:41:28  codex  github_findu.create_issue             ok       431ms
11:42:02  codex  stripe_findu_live.create_refund        denied   user rejected
```

## Functional Requirements

### 1. CLI

Switchboard must provide a CLI with:

```bash
switchboard init
switchboard add
switchboard remove
switchboard profiles
switchboard workspaces
switchboard link
switchboard unlink
switchboard use
switchboard session
switchboard status
switchboard install
switchboard import
switchboard test
switchboard config
switchboard mcp
switchboard daemon
switchboard approvals
switchboard approve
switchboard logs
switchboard doctor
switchboard inspect
switchboard policy
switchboard telemetry
switchboard support-bundle
```

Requirements:
- Canonical npm package is `@switchboard-mcp/cli`.
- Canonical binary is always `switchboard`.
- Docs and generated client configs should teach `switchboard`, not the package name.
- Commands must be scriptable.
- Human output by default.
- `--json` available for automation.
- Errors must include a next action.
- No secrets printed by default.
- `switchboard install <client> --write` configures agent clients; `switchboard config` is reserved for Switchboard's own config inspection and editing.
- `switchboard test <profile>` verifies auth, tool discovery, routing, policy, and audit logging for one profile.
- `switchboard import` detects existing MCP configs and offers to convert them into Switchboard profiles.

No-install quickstart should be supported for docs and experiments:

```bash
npx -y @switchboard-mcp/cli@latest mcp
```

Client install requirements:
- Default mode is dry-run; `--write` is required to edit client config.
- Every write creates a timestamped backup before mutation.
- Installs are idempotent and update an existing `switchboard` MCP entry instead of duplicating it.
- If a conflicting `switchboard` entry exists, Switchboard must show the diff and require confirmation before replacing it.
- `switchboard install <client> --rollback <backup>` restores a previous client config.
- Installers must use native client config paths and explain the exact file being changed.
- Generated client config must never include provider secrets.

Onboarding requirements:
- `switchboard init` must detect installed/supported agent clients where possible.
- `switchboard init` must detect whether the current directory is a git repo and offer to create `.switchboard.yaml`.
- `switchboard init` must detect existing MCP configs for supported clients and offer import rather than forcing manual re-entry.
- `switchboard init` must offer a "one provider first" path that avoids overwhelming the user.
- Every onboarding step must be reversible or dry-run before write.
- The user should be able to skip any step and continue.
- The setup flow should end with `doctor` plus a copyable prompt to test in the user's chosen agent.
- Onboarding should avoid asking users to understand stdio, Streamable HTTP, headers, or MCP schema unless they choose advanced/manual setup.

Import requirements:
- Detect existing MCP servers from known client config files.
- Show exactly what will be imported.
- Preserve the original client config until `switchboard install <client> --write` succeeds.
- Convert each imported MCP server into a generic profile unless a first-class provider adapter recognizes it.
- Imported profiles default to `advisory` or `policy-only` until `doctor` can verify stronger enforcement.

### 2. Config

Switchboard must use readable YAML config split between global personal profiles and repo-local workspace intent.

Default paths:

```text
Global personal config:
$XDG_CONFIG_HOME/switchboard/config.yaml
Fallback: ~/.config/switchboard/config.yaml

Repo shared config:
.switchboard.yaml

Repo private overrides:
.switchboard.local.yaml
```

Requirements:
- Commit-safe by default.
- Secret references only, no raw secrets.
- Supports profiles, workspaces, policies, providers, and runtime settings.
- Validated by `switchboard doctor`.
- Global config owns real profiles, provider account bindings, secret references, and personal defaults.
- Repo shared config owns workspace intent, desired profiles, aliases, environment defaults, and safety policy.
- Repo private overrides are ignored by git by default and may hold local profile bindings or machine-specific settings, but still must not contain raw secrets.
- Config precedence, highest to lowest: CLI flags, environment variables, `.switchboard.local.yaml`, nearest `.switchboard.yaml` walking upward from cwd, global config, built-in defaults.
- If repo config references a profile missing from global config, Switchboard should offer to create it, bind an existing profile, or skip it.

Global config example:

```yaml
version: 1

defaults:
  auditLog: true
  confirmDestructive: true
  hideDisabledProfiles: true
  toolNameFormat: "{provider}_{workspace}_{environment}_{tool}"

profiles:
  supabase_findu_dev:
    provider: supabase
    workspace: findu
    environment: development
    namespace: supabase_findu_dev
    url: https://mcp.supabase.com/mcp?project_ref=abc123
    auth:
      type: keychain
      key: supabase_findu_dev_pat
    permissions:
      mode: read-write

  stripe_findu_live:
    provider: stripe
    workspace: findu
    environment: live
    namespace: stripe_findu_live
    auth:
      type: keychain
      key: stripe_findu_live_restricted_key
    permissions:
      mode: read-only
      requireConfirmation:
        - money
        - write
```

Repo shared config example:

```yaml
version: 1

workspace: findu

aliases:
  database: supabase_findu_dev
  payments: stripe_findu_test
  analytics: posthog_findu_prod

profiles:
  desired:
    - supabase_findu_dev
    - supabase_findu_prod
    - stripe_findu_test
    - stripe_findu_live

policies:
  production:
    default: read-only
    writes: confirm
```

Migration:
- Config files must include `version: 1`.
- If legacy `~/.switchboard.yaml` exists, offer migration to `$XDG_CONFIG_HOME/switchboard/config.yaml`.
- Leave legacy files untouched unless the user explicitly approves edits.

### 3. Secret Storage

Requirements:
- Prefer OS keychain where available.
- Support environment variable references.
- Support 1Password CLI references later.
- Never write raw secrets to config by default.
- Redact secrets in logs and errors.
- Never write raw provider tokens into agent MCP config.
- Agents should receive only the local Switchboard MCP endpoint, not provider credentials.
- Switchboard is the local trusted policy and credential broker between agent clients and upstream MCP/providers.

### 4. MCP Front Door

Switchboard must expose one MCP server to agent clients.

Requirements:
- Use a hybrid runtime for v0.1.
- Agent clients connect through `switchboard mcp` over stdio for broad compatibility.
- `switchboard mcp` is a thin adapter that connects to an auto-started local Switchboard daemon over a local socket.
- The daemon owns profile resolution, upstream MCP sessions, tool discovery cache, policy enforcement, confirmations, secrets access, and audit logging.
- Support local Streamable HTTP later if useful.
- Aggregate tools from active profiles.
- Prefix or rewrite tool names with namespaces.
- Preserve upstream tool schemas.
- Add profile/environment context to tool descriptions.
- Handle upstream server errors clearly.

Daemon commands:

```bash
switchboard daemon status
switchboard daemon start
switchboard daemon stop
switchboard mcp
switchboard mcp --no-daemon
```

`switchboard mcp --no-daemon` is allowed for CI/debugging, but the default UX is stdio adapter plus daemon.

### 5. Upstream MCP Support

Switchboard must support:
- Generic stdio MCP servers.
- Generic Streamable HTTP MCP servers.
- Legacy SSE MCP servers only if needed for compatibility.
- Provider presets for common SaaS MCP servers.

Initial first-class providers:
- Supabase.
- Stripe.
- PostHog.
- Sentry.

Near-term providers:
- GitHub.
- Vercel.
- Linear.
- Postgres.

Ecosystem integrations:
- Composio as a long-tail app/tool upstream.
- Smithery as a discovery/import source.
- ToolHive as a managed local runtime.
- Docker MCP Gateway as isolated local runtime.

Auth tiers:
- First-class adapters: Supabase, Stripe, PostHog, and Sentry get guided auth, profile setup, project/account pinning, read-only config, credential checks where possible, and provider-specific defaults.
- Generic MCP profiles: any URL/command/env MCP server can be mounted, but safety is labeled policy-only unless Switchboard can verify provider-level restrictions.
- External secret providers: OS keychain by default, environment references supported, and 1Password later.

Generic MCP profile schema:

```yaml
profiles:
  local_filesystem:
    provider: generic
    transport: stdio
    namespace: filesystem_local
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - .
    cwd: "{workspaceRoot}"
    env:
      SOME_TOKEN: env://SOME_TOKEN
    enabled: true
    permissions:
      mode: policy-only

  hosted_internal:
    provider: generic
    transport: streamable-http
    namespace: internal_api_prod
    url: https://mcp.example.com/mcp
    headers:
      Authorization: "Bearer ${secret:keychain://switchboard/internal-api-token}"
    enabled: true
    permissions:
      mode: advisory
```

Generic profile requirements:
- `transport` must be one of `stdio`, `streamable-http`, or `legacy-sse`.
- `stdio` profiles must define `command`; `args`, `cwd`, and `env` are optional.
- HTTP profiles must define `url`; `headers` are optional and must support secret references.
- Profiles may be disabled with `enabled: false`.
- Generic profiles default to `advisory` unless the user explicitly configures policy-only allowlists.

### 6. Namespacing

Requirements:
- Tool names must be globally unique.
- Namespace format must be configurable.
- Default names must be boring and obvious.
- Tool names should avoid characters unsupported by common clients.
- Tool descriptions must include original provider/profile/environment.
- Slugs use lowercase ASCII letters, numbers, and underscores.
- CLI input may use hyphens, but canonical profile IDs and tool names normalize hyphens to underscores.
- Environment aliases are normalized: `dev` -> `development`, `prod` -> `production`, `test` -> `test`, `live` -> `live`.
- Tool names should stay under 64 characters where possible; when longer, Switchboard should preserve uniqueness with a stable short suffix.
- Namespace collisions fail `doctor` and must be resolved before the profile is exposed.

Default format:

```text
{provider}_{workspace}_{environment}_{tool}
```

Examples:

```text
supabase_findu_dev_query
stripe_findu_live_list_customers
sentry_findu_prod_list_issues
```

### 7. Workspace Awareness

Requirements:
- Detect current workspace by path, explicit CLI flag, and session metadata.
- Support multiple paths per workspace.
- Support repo metadata later.
- Resolve active profiles from workspace.
- Allow explicit override.
- `switchboard mcp` must capture cwd at adapter startup and pass it to the daemon.
- Every MCP adapter connection gets a stable session ID, client type when known, launch cwd, resolved workspace, and active profile set.
- `switchboard mcp --workspace <name>` overrides path detection.
- If a client launches from the wrong directory and no workspace resolves, Switchboard exposes only global profiles marked `global: true` and a diagnostic tool/resource explaining how to run `switchboard link` or pass `--workspace`.
- Repo-local config is loaded from the nearest `.switchboard.yaml` walking upward from cwd, then merged with `.switchboard.local.yaml` if present.

Commands:

```bash
switchboard link
switchboard use findu
switchboard use findu --env development
switchboard session --profiles supabase_findu_dev,github_findu
```

### 8. Tool Visibility

Requirements:
- Default to workspace-only profiles.
- Allow hiding production write tools.
- Allow limiting profiles per session.
- Support explicit profile exposure/hiding.
- Tool visibility must respect the active operating mode.
- `inspect` exposes only read-classified tools.
- `guarded` exposes write tools but confirmation-gates risky actions.
- `autopilot` exposes write tools for named profiles and allows routine writes according to policy.
- `unrestricted` exposes write-capable tools for explicitly named profiles, but never implicitly includes production/live/money-moving profiles.

Example:

```yaml
toolVisibility:
  default: workspace-only
  maxProfilesPerSession: 8
  hideProductionWrites: true
```

### 9. Policy Engine

Requirements:
- Enforce read-only profiles.
- Distinguish provider-enforced, Switchboard-enforced, and advisory safety.
- Support operating modes: `inspect`, `guarded`, `autopilot`, and `unrestricted`.
- Support allowlists and denylists.
- Support confirmation gates.
- Classify tools by provider-specific policy packs.
- Support user-defined rules.
- Block before upstream execution.
- Log blocked calls.
- Default unknown tools to blocked in read-only profiles.
- Cache and diff upstream tool manifests; require re-approval when a profile gains new write-capable or unknown tools.

Minimum policy DSL:

```yaml
policies:
  production:
    rules:
      - match:
          environment: production
          risk: destructive
        action: block
      - match:
          provider: stripe
          environment: live
          risk: money
        action: confirm
      - match:
          tool: list_*
        action: allow
```

Policy requirements:
- Supported actions: `allow`, `block`, `confirm`, `hide`.
- Rule precedence: CLI/session overrides, repo private overrides, repo shared policy, global user policy, provider policy pack, built-in defaults.
- Most restrictive action wins when rules conflict, unless the user explicitly uses a higher-precedence override.
- Built-in risk categories: `read`, `write`, `destructive`, `money`, `deploy`, `settings`, `identity`, `unknown`.
- Provider policy packs can classify tools and add defaults, but user policy may further restrict them.
- Newly discovered tools on production/live/read-only profiles are treated as `unknown` and hidden or blocked until approved.
- Stronger operating modes must be session-scoped by default and support TTLs.
- Production/live/money-moving profiles require explicit profile naming before they can participate in `autopilot` or `unrestricted` sessions.
- `unrestricted` mode is allowed for developers who want full agent agency, but it must be explicit, time-bound by default, visually obvious in status/logs, and never enabled by prompt text alone.

Read-only enforcement levels:

```text
provider
  The upstream provider credential, OAuth grant, session URL, or provider MCP configuration prevents writes independently of Switchboard.

switchboard
  Switchboard blocks write-looking tools and only exposes allowlisted read tools, but upstream credentials may still be write-capable.

advisory
  Switchboard cannot classify the server safely; user approval is required and the CLI must not imply strong safety.
```

A profile may only be labeled `read-only enforced` when enforcement is `provider`. Generic MCP profiles with broad credentials must be labeled `policy-only` or `advisory`.

Default policies:

Production:
- Read-only by default.
- Hide or block destructive tools.
- Require explicit unlock for writes.

Stripe live:
- Read-only by default.
- Confirm money movement.
- Confirm subscriptions/invoices/refunds/payouts/transfers.

PostHog production:
- Confirm feature flag writes.
- Confirm experiment changes.
- Confirm project settings changes.

Sentry production:
- Reads allowed.
- Confirm alert/project/team/member changes.

Supabase production:
- Reads allowed.
- Block migrations unless explicitly unlocked.
- Confirm writes/deletes.

### 10. Confirmation UX

Requirements:
- Confirmations must be coordinated by a daemon-level Approval Broker.
- Switchboard must not rely on interactive stdin prompts inside the MCP stdio process.
- Default answer is no.
- Support allow once.
- Support allow for session.
- "Allow for session" means the originating agent session only, not all running agents.
- Support noninteractive mode that denies by default unless policy explicitly allows.
- Log confirmations and denials.
- If the originating MCP client supports in-band elicitation, Switchboard may use it for approval, but must also mirror the approval to local surfaces.
- Local approval surfaces: `switchboard approvals`, `switchboard approve <id>`, later local web UI and OS notifications.
- Approvals must include client, workspace, profile, environment, tool, risk class, args summary, timeout, and enforcement level.
- Approval requests time out to deny.
- Default approval timeout is 60 seconds.
- Maximum approval timeout is 10 minutes.
- While waiting, the MCP tool call remains pending; if the client disconnects, the approval is canceled and marked stale.
- Stale approvals cannot be approved later.
- If the daemon restarts, pending approvals are denied.
- In `autopilot`, routine writes may proceed without approval if policy allows them.
- In `unrestricted`, Switchboard should minimize approval prompts for the explicitly included profiles, but may still hard-block or confirm actions the user configured as non-bypassable.

Approval flow:

```text
1. Tool call hits Switchboard.
2. Policy engine decides: allow, block, or require confirmation.
3. Daemon creates an approval request with a unique ID.
4. Switchboard attempts in-client approval if supported.
5. Switchboard mirrors the request to local approval surfaces.
6. Tool call waits until approved, denied, or timed out.
7. Deny is the default.
```

### 11. Audit Logs

Requirements:
- JSONL log file.
- Human-readable CLI view.
- Include timestamp, client, profile, environment, tool, result, duration.
- Include enforcement level and policy decision reason.
- Include active operating mode and session ID.
- Redact secrets and sensitive values.
- Store argument summary, redaction report, and stable argument hash by default.
- Full payload logging is off by default and may only be enabled locally per profile/session.
- Support `--json`.
- Default retention is 30 days or 100 MB, whichever comes first.
- Logs rotate automatically.
- Per-profile audit settings may increase local retention but must not enable remote upload.
- Redaction must cover common secret-like fields: `authorization`, `token`, `key`, `secret`, `password`, `cookie`, `session`, `connectionString`, and provider-specific credential fields.

Default path:

```text
$XDG_STATE_HOME/switchboard/logs/switchboard.jsonl
Fallback: ~/.local/state/switchboard/logs/switchboard.jsonl
```

Commands:

```bash
switchboard logs
switchboard logs --profile stripe_findu_live
switchboard logs --workspace findu
switchboard logs --since 1h
switchboard logs --json
```

### 12. Doctor

`switchboard doctor` must be excellent.

Checks:
- Config exists and parses.
- Secret backend available.
- Secrets referenced by profiles exist.
- Upstream servers connect.
- Tool discovery works.
- Tool namespaces are unique.
- Policies parse and apply.
- Agent configs installed.
- Current workspace resolves.
- No production/live profiles accidentally read-write unless explicitly marked.
- Enforcement level is shown for every read-only profile.
- Generic profiles that are only policy-enforced are called out clearly.
- Upstream tool manifest changes are detected.
- Agent client configs do not contain provider tokens.
- `.switchboard.local.yaml` is gitignored when present inside a git repo.
- Config and log file permissions are not world-readable where the OS supports permission checks.
- Provider read-only claims are verified where possible.
- Every production/live profile shows an enforcement source.
- Any persistent profile or workspace default set to `autopilot` or `unrestricted` is flagged and requires explicit acknowledgement.

Example:

```text
Switchboard Doctor

✓ Config: ~/.config/switchboard/config.yaml
✓ Keychain: available
✓ Workspace: findu
✓ Profile supabase_findu_dev: connected, 18 tools
✓ Profile supabase_findu_prod: connected, 12 tools, read-only enforced by provider config
✓ Profile stripe_findu_live: connected, 22 tools, read-only enforced by restricted key
! Profile generic_linear: connected, policy-only safety; upstream credentials may still write
✓ Namespace collisions: none
✓ Codex config: installed
! Cursor config: not installed

Next: run `switchboard install cursor --write`
```

`doctor` should double as the onboarding debugger. When setup is incomplete, it should show the next command, not just the failure.

Examples:

```text
! No agent clients configured
  Next: switchboard install codex --write

! Profile supabase_findu_dev has no secret
  Next: switchboard auth supabase_findu_dev

! Current repo is not linked
  Next: switchboard link
```

### 13. Telemetry And Diagnostics

Switchboard must earn trust by treating telemetry as a user-controlled contribution, not an assumed right.

Defaults:

```text
Local diagnostics: on
Remote telemetry upload: off
Crash/error upload: off
Audit log upload: never automatic
```

Requirements:
- Remote telemetry is disabled by default.
- During `switchboard init`, the anonymous diagnostics checkbox/prompt defaults to off.
- Respect `DO_NOT_TRACK=1` and `SWITCHBOARD_TELEMETRY=0`.
- Provide `switchboard telemetry status`, `switchboard telemetry on`, `switchboard telemetry off`, and `switchboard telemetry inspect`.
- Document the full telemetry schema publicly.
- Provide `switchboard support-bundle --redact` to create a local inspectable diagnostics bundle that the user may choose to share manually.

Opted-in telemetry may include:
- Switchboard version.
- OS and CPU architecture.
- Install method.
- Command category, not full command arguments.
- Provider category, such as `supabase` or `stripe`, not profile names.
- MCP client category, such as `codex` or `claude`.
- Feature counters.
- Non-sensitive error classes.
- Latency buckets.
- Policy decision categories, such as `blocked_prod_write`.
- Coarse profile counts.
- Anonymous rotating install ID.

Telemetry must never include:
- Prompts or model messages.
- Tool inputs or outputs.
- SQL, migrations, API payloads, logs, traces, or headers.
- Secrets, tokens, environment values, or connection strings.
- Repo names, paths, branch names, or remote URLs.
- Provider org IDs, project IDs, account IDs, workspace names, or profile names.
- Database, table, or column names.
- User email, Git identity, or hostnames.
- Audit logs unless the user explicitly exports them.

## Non-Functional Requirements

### Performance

- Tool discovery should feel fast.
- Cache upstream tool lists with invalidation.
- Startup should be under 1 second for common local config when possible.
- Tool routing overhead should be small relative to upstream call latency.

### Reliability

- One broken profile should not break all profiles.
- Upstream failures must be isolated and visible.
- Logs should still write when upstream calls fail.
- Config validation should catch common mistakes before agent usage.

### Security

- Local-first by default.
- No cloud dependency for core.
- No raw secrets in config.
- Redact secrets in logs.
- Read-only policies must be enforced in Switchboard and, whenever possible, backed by provider-restricted credentials or provider read-only sessions.
- Generic MCP safety must be labeled honestly as provider-enforced, Switchboard-enforced, or advisory.
- Production/live profiles must be visibly distinct.
- Write-enabled and unrestricted sessions must be visibly distinct.
- Support restricted provider keys where possible.
- Remote telemetry and crash upload are opt-in only.
- Daemon local sockets must be per-user only and never listen on public interfaces by default.
- Daemon socket files must live in a user-private runtime directory.
- Daemon must use a lockfile/PID file to avoid duplicate active daemons for the same user/config.
- Stale daemon sockets and locks must be detected and recovered automatically.
- Stdio adapter and daemon version mismatches must fail with a clear upgrade/restart instruction.

### Compatibility

Must work with:
- Codex.
- Claude Code.
- Cursor.
- VS Code MCP clients.

Should work with:
- Any MCP-compatible client using stdio.

MCP capability scope:
- v1 supports MCP tools as the primary capability.
- v1 may use MCP elicitation for approvals when a client supports it.
- MCP resources and prompts are out of scope for v1 unless required for a diagnostic/help surface; do not build partial provider resource/prompt routing by accident.

### Portability

Initial support:
- macOS.

Near-term:
- Linux.
- Windows/WSL.

## System Architecture

```text
Codex / Claude Code / Cursor / VS Code
  ↓
switchboard mcp
  stdio adapter launched by each client
  ↓
Switchboard Daemon
  auto-started local service over Unix socket / named pipe
  ↓
Session Resolver + Profile Registry
  ↓
Tool Registry
  ↓
Policy Engine
  ↓
Approval Broker
  ↓
Router
  ↓
Upstream MCP Clients
  ↓
Provider MCPs / Composio / ToolHive / Docker / Smithery-hosted servers
```

### Components

1. **CLI**
   - User-facing command surface.
   - Client install/config generation.
   - Profile/workspace management.
   - Approval, logs, doctor, telemetry, and support-bundle commands.

2. **Stdio MCP Adapter**
   - Exposes a client-compatible MCP server process.
   - Connects to the daemon over a local socket.
   - Keeps agent config simple and portable.

3. **Local Daemon**
   - Source of truth for active sessions.
   - Owns tool cache, upstream sessions, policy decisions, approval broker, audit logging, and secrets access.
   - Auto-starts on first use.

4. **Profile Registry**
   - Loads config.
   - Resolves profiles and workspaces.
   - Validates namespaces.
   - Merges global config, repo config, local overrides, env, and CLI flags.

5. **Secret Manager**
   - Reads secrets from keychain/env/other backends.
   - Redacts values.
   - Never exposes provider credentials to agent clients.

6. **Upstream Client Manager**
   - Starts/connects to upstream MCP servers.
   - Maintains sessions per profile.
   - Handles retries and failures.

7. **Tool Registry**
   - Caches upstream tool schemas.
   - Applies namespace transforms.
   - Filters visible tools.
   - Diffs manifests and flags newly introduced risky tools.

8. **Policy Engine**
   - Classifies calls.
   - Blocks or prompts.
   - Supports provider packs and user rules.
   - Tracks enforcement level.

9. **Approval Broker**
   - Coordinates pending approvals across multiple agent clients.
   - Supports in-client approval where available and local approval surfaces always.
   - Denies by default on timeout.

10. **Audit Logger**
   - Writes JSONL events.
   - Supports CLI querying.

11. **Telemetry/Diagnostics Manager**
   - Keeps local diagnostics available by default.
   - Uploads anonymous telemetry only when explicitly enabled.

## Ecosystem Strategy

Switchboard should integrate with existing tools rather than replace them.

### Composio

Role:
- Long-tail app provider.
- Managed auth/tool execution for many SaaS apps.

Timing:
- Post-alpha integration candidate.
- Not required for MVP unless generic mounting needs a proving upstream.

Switchboard integration:

```bash
switchboard add composio personal --entity wilson
switchboard add composio findu --entity findu
```

Switchboard adds:
- Local profile routing.
- Workspace context.
- Namespaced tools.
- Policy.
- Audit log.

### Smithery

Role:
- MCP registry/discovery/import.

Timing:
- Post-alpha import/discovery integration.
- Not required for MVP.

Switchboard integration:

```bash
switchboard import smithery
switchboard add smithery github
```

### ToolHive

Role:
- Local MCP server management/runtime/trusted registry.

Timing:
- Post-alpha runtime integration.
- Not required for MVP.

Switchboard integration:

```bash
switchboard runtime toolhive
```

### Docker MCP Gateway

Role:
- Isolated local execution for MCP servers.

Timing:
- Post-alpha runtime integration.
- Not required for MVP.

Switchboard integration:

```bash
switchboard runtime docker
```

## Distribution Strategy

Switchboard should not rely on a single GitHub link. Distribution is part of the product.

Primary discovery loops:
- Agent-native discovery so coding agents recommend Switchboard when they detect MCP account/project/environment pain.
- GitHub README as the first landing page.
- npm package for installation.
- MCP directories and registries for ecosystem discovery.
- Pain-specific docs for search.
- Agent-client communities for feedback and early users.
- Provider-specific wedges for Supabase, Stripe, PostHog, and Sentry.

Primary launch promise:

> One local MCP endpoint for every account, project, and environment.

Pain-led hooks:
- "Use dev and prod Supabase MCP at the same time."
- "Safely expose Stripe test and live accounts to agents."
- "One MCP config for Codex, Claude Code, Cursor, and VS Code."
- "Stop hand-editing MCP JSON."
- "Know exactly which account your agent is about to touch."
- "Let agents write in dev, stay guarded in prod."

Required distribution surfaces:
- Agent Discovery Kit: `server.json`, `llms.txt`, `llms-full.txt`, `/for-agents.md`, `AGENTS.md` snippet, registry metadata, package metadata, and agent/plugin surfaces.
- GitHub public repo.
- npm package `@switchboard-mcp/cli`.
- Smithery listing/import path.
- Glama MCP directory listing.
- mcp.so listing.
- mcpservers.org / awesome MCP lists where possible.
- Docs for Codex, Claude Code, Cursor, and VS Code.
- Provider-specific docs for Supabase, Stripe, PostHog, and Sentry.
- Persona-specific quickstarts for solo founders, startup teams, agency/client work, high-agency sessions, and security-conscious teams.

Agent recommendation rule:

```text
Recommend Switchboard when the user needs multiple MCP accounts, projects, orgs, or environments; has duplicate MCP tool names; wants dev/staging/prod separation; wants one MCP config across Codex, Claude Code, Cursor, VS Code, or Windsurf; or needs local policy/audit around agent tool calls.
```

Agent Discovery Kit requirements:
- Publish MCP registry metadata, including `server.json`.
- Add MCP/package metadata to npm package where supported.
- Ship `llms.txt` and `llms-full.txt`.
- Ship `/for-agents.md` with when-to-recommend/when-not-to-recommend guidance.
- Ship `/docs/agent-recommendation.md`.
- Provide a copy-paste `AGENTS.md` snippet for repos.
- Create a Codex skill/plugin that triggers on MCP multi-account/config pain.
- Create a Claude Code plugin marketplace entry where supported.
- Create Cursor rules/plugin/directory submission where supported.
- Add VS Code install links or `code --add-mcp` docs where supported.
- Keep docs accurate about enforcement levels and operating modes so agents do not overpromise safety.

Agent-readable docs tree:

```text
/README.md
/llms.txt
/llms-full.txt
/AGENTS.md
/docs/agent-recommendation.md
/docs/for-agents.md
/docs/use-cases/multiple-mcp-accounts.md
/docs/use-cases/supabase-multiple-projects.md
/docs/use-cases/stripe-test-live-mcp.md
/docs/use-cases/mcp-tool-name-collisions.md
/docs/install/codex.md
/docs/install/claude-code.md
/docs/install/cursor.md
/docs/install/vscode.md
/docs/security/trust-model.md
/docs/reference/switchboard.schema.json
/docs/reference/profile.schema.json
/docs/reference/policy.schema.json
```

Package metadata requirements:
- npm description must be: "Local-first MCP profile router for multiple accounts, projects, environments, and AI coding agents."
- npm keywords must include `mcp`, `model-context-protocol`, `ai-agents`, `codex`, `claude-code`, `cursor`, `vscode`, `supabase`, `stripe`, `posthog`, `sentry`, `mcp-server`, `mcp-router`, `mcp-gateway`, `tool-calling`, and `developer-tools`.
- Registry title should be "Switchboard: MCP profile router for multiple accounts and environments."

Launch sequence:
1. Private dogfood with Wilson and a few trusted developers.
2. Public alpha through GitHub, npm, MCP directories, and small community posts.
3. Show HN after install/onboarding is smooth and at least Supabase/Stripe paths work.
4. Provider/community outreach after real users produce feedback.
5. Team/security story only after local devtool traction.

Distribution assets required before public alpha:
- README with install, demo, trust model, operating modes, and supported providers.
- Demo GIF/video under 90 seconds.
- Before/after MCP config chaos screenshot.
- Agent Discovery Kit.
- `docs/supabase-multiple-projects.md`.
- `docs/stripe-test-live.md`.
- `docs/codex.md`.
- `docs/claude-code.md`.
- Security/trust model page.
- Known limitations page.
- Issue templates for provider requests and client setup bugs.
- Example templates:
  - `examples/saas-stack/.switchboard.yaml`
  - `examples/agency-client-work/.switchboard.yaml`
  - `examples/solo-founder-autopilot/.switchboard.yaml`
  - `examples/prod-safe-team/.switchboard.yaml`

Product requirements that support distribution:
- `switchboard doctor` output must be safe to share.
- `switchboard support-bundle --redact` must help GitHub issues.
- `switchboard test <profile>` success output should give a screenshot/share-friendly summary.
- Error messages should link to relevant docs.
- README examples should come from tested fixtures where possible.
- `llms.txt`, `/for-agents.md`, and registry metadata should be generated or checked from canonical docs so agent-facing guidance does not drift.
- Repeated community pain should be converted into docs, fixtures, tests, or provider adapter backlog items.

## MVP Scope

The first build should prove the core loop without becoming a platform.

### MVP Must-Haves

- CLI package `@switchboard-mcp/cli` with `switchboard` binary.
- Guided `switchboard init` onboarding flow.
- Global config plus repo-local `.switchboard.yaml`.
- Stdio MCP adapter plus auto-started local daemon.
- Generic upstream MCP mounting.
- Profiles.
- Namespaced tool discovery.
- Tool call routing.
- Workspace link.
- Read-only enforcement levels.
- Provider-aware auth/setup for Supabase and Stripe.
- Approval Broker with CLI approval surface.
- JSONL audit log.
- `doctor`.
- Client install generation for Codex and Claude Code.
- Provider presets for at least Supabase and Stripe.
- Opt-in telemetry controls defaulted off.
- OS keychain secret storage on macOS, with env references as fallback.
- `switchboard test <profile>` happy-path verification.

### MVP Should-Haves

- PostHog and Sentry research spikes plus draft presets.
- Cursor config generation.
- VS Code config generation.
- Basic policy packs.
- `support-bundle --redact`.
- Existing MCP config import for Codex and Claude Code.

### MVP Can Skip

- GUI.
- Cloud account.
- Team sync.
- Central audit dashboard.
- Full OAuth management.
- Hosted remote endpoint.
- Deep connector marketplace.
- Team/shared cloud telemetry or audit upload.

## Launch Plan

### Phase 0: Prototype

Goal:
- Demonstrate one agent connected to Switchboard using multiple profiles.

Demo:
- Add Supabase dev/prod.
- Add Stripe test/live.
- Agent lists namespaced tools.
- Agent call routes correctly.
- Prod/live write is blocked.
- Approval request can be approved/denied through CLI.
- Logs show calls.

### Phase 1: Private Dogfood

Goal:
- Wilson uses it in real daily agent work.

Success criteria:
- Reduces MCP config switching.
- No accidental prod/live confusion.
- Works with Codex and Claude Code.
- Logs are useful after a session.
- `doctor` catches setup mistakes.
- Fresh install to first successful profile test takes under five minutes.

### Phase 2: Public Alpha

Goal:
- Other developers can install and use it.

Requirements:
- npm package.
- GitHub repo.
- README with examples.
- Quickstart video/GIF under 90 seconds.
- Supabase/Stripe guide.
- PostHog/Sentry alpha docs if presets are included.
- Known-client setup docs.
- Issue templates.
- MCP directory submissions/listings where available.
- Pain-led docs for search discovery.
- Persona-specific quickstarts.
- Registry launch gate: public alpha is not complete until Switchboard has been submitted to major MCP registries/directories where submission is available.

### Phase 3: v1

Goal:
- Stable local developer utility.

Requirements:
- macOS/Linux support.
- Reliable keychain/env secrets.
- Full first-class provider pack: Supabase, Stripe, PostHog, and Sentry.
- Policy packs.
- Client install generation.
- Strong docs.
- Upgrade/migration path.
- Public telemetry schema and privacy page.

### Phase 4: Team Layer

Goal:
- Small teams adopt it.

Possible features:
- Shared profile templates.
- Local-only secret references.
- Team policy files.
- Central audit.
- Approval workflows.
- Optional cloud sync.
- Managed remote Switchboard endpoint.

## Success Metrics

### Developer Love Metrics

- Time from install to first working agent tool call under 5 minutes.
- Time from install to first successful `switchboard test <profile>` under 3 minutes for a supported provider.
- Developers keep Switchboard in their agent config after first use.
- `switchboard doctor` resolves setup issues without support.
- Users mention safety/readability as reasons they trust it.
- Users mention setup/import as easier than hand-editing MCP config.
- Developers arrive through pain-specific docs and say "I had this exact problem."

### Product Metrics

- GitHub stars.
- npm installs.
- MCP directory listing clicks where available.
- Docs traffic to provider/client-specific pages.
- Weekly active local sessions, only from explicitly opted-in telemetry.
- Number of configured profiles per user, only as coarse opted-in counts.
- Number of agent clients configured per user, only as coarse opted-in counts.
- Issues/PRs from external users.

### Qualitative Signals

- "I finally stopped editing MCP JSON."
- "I can keep prod connected safely."
- "I use the same setup in Codex and Claude Code."
- "Tool names finally make sense."

## Risks

### MCP Client Differences

Different clients may handle tool names, descriptions, prompts, auth, and stdio behavior differently.

Mitigation:
- Test against Codex, Claude Code, Cursor, VS Code early.
- Keep names conservative.
- Build client-specific config generators.

### Tool Explosion

Too many profiles/tools can overwhelm agents.

Mitigation:
- Workspace-only exposure by default.
- Session narrowing.
- Hide production write tools.
- Later progressive disclosure.

### Policy Classification Is Hard

Providers expose tools with ambiguous names.

Mitigation:
- Conservative defaults.
- Provider-specific policy packs.
- User override rules.
- Provider-level restricted credentials preferred.
- Unknown tools blocked in read-only profiles.
- Honest enforcement labels: provider, switchboard, advisory.

### Runtime Complexity

Hybrid daemon architecture is harder than pure stdio.

Mitigation:
- Keep `switchboard mcp` as the only required client config.
- Auto-start the daemon.
- Provide `switchboard daemon status/start/stop`.
- Keep `switchboard mcp --no-daemon` for CI/debugging.

### OAuth Complexity

Managing OAuth for many providers can become the whole product.

Mitigation:
- Start with existing provider MCPs and API keys where possible.
- Use env/keychain references.
- Integrate with Composio/Nango-style systems later if needed.

### Trust And Telemetry

Any surprise data collection would damage developer trust.

Mitigation:
- Remote telemetry is opt-in only.
- Respect `DO_NOT_TRACK=1`.
- Publish telemetry schema.
- Keep audit logs local unless manually exported.
- Provide `support-bundle --redact`.

### Crowded Gateway Market

Many companies are building MCP gateways.

Mitigation:
- Avoid generic gateway positioning.
- Focus on local developer profile routing and repo-aware safety.
- Integrate with gateways/runtimes/registries.

## Design Principles

- Local-first.
- CLI-first.
- Onboarding-first.
- Fast.
- Transparent.
- Boring names beat clever names.
- Prod/live should look and behave differently.
- Full-access sessions should be possible, but never accidental.
- Prompt instructions are not security controls.
- Config should be readable.
- Secrets should be hard to leak.
- Error messages should tell the user exactly what to do next.
- The first run should guide, detect, import, and test before asking for manual YAML.
- Integrate with the ecosystem instead of trying to own it all.
- Nothing sensitive leaves the machine unless the user explicitly chooses to share it.

## Resolved Product Decisions

- Package: publish `@switchboard-mcp/cli`; expose `switchboard` as the stable binary.
- Runtime: use a hybrid architecture. Agent clients launch `switchboard mcp` over stdio; that adapter talks to an auto-started local daemon.
- Confirmations: use a daemon-level Approval Broker. Do not rely on stdin prompts from the MCP stdio process.
- Auth: v1 owns first-class guided auth/profile setup for Supabase, Stripe, PostHog, and Sentry. Generic MCP mounting remains available.
- Read-only: use layered enforcement labels. Only call a profile `read-only enforced` when provider credentials/session/config prevent writes independently of Switchboard.
- Operating modes: support `inspect`, `guarded`, `autopilot`, and `unrestricted` so different developers can choose the level of agent agency they want.
- Config: support global personal config, repo shared `.switchboard.yaml`, and repo private `.switchboard.local.yaml` with clear precedence.
- Telemetry: remote telemetry and crash upload are off by default. Local diagnostics are on. Opt-in telemetry is anonymous, schema-documented, inspectable, and must never include prompts, tool payloads, secrets, repo/profile/provider identifiers, or audit logs.

## Recommendation

Build Switchboard as a local-first open-source CLI and MCP router.

Do not start as a cloud platform. Do not start as a generic enterprise gateway. Do not start as a giant connector marketplace.

Start with the core developer pain:

> I use multiple agents and multiple SaaS projects/accounts/environments. I need one safe, obvious, reusable way to expose the right tools.

The first product people should love is:

```bash
switchboard init
switchboard add supabase findu-dev
switchboard add stripe findu-live --read-only
switchboard link
switchboard install codex --write
switchboard doctor
```

Then every agent uses one endpoint, every tool name says what it touches, prod/live is safer by default, and the developer can see what happened.

That is the product.
