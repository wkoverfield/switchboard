# Adversarial Alpha Eval: 2026-06-27

Three independent agent evaluators tested the published `@switchboard-mcp/cli`
alpha from different buyer/user postures:

- skeptical solo developer who dislikes extra tooling
- security-minded devtools/platform engineer
- advanced harness/subagent builder

The evaluated launch hypothesis was:

> Find risky MCP/tool access in your repo and turn it into scoped agent
> permissions.

## Validated

- `switchboard scan` is a good first command: fast, local, and understandable.
- `switchboard import --dry-run` is the clearest early aha. It detects existing
  Codex/Claude MCP config, reports server names and secret-looking env names,
  and proposes Switchboard profiles without reading env-file values.
- `switchboard import --write` can produce readable `.switchboard.yaml` profiles.
- `switchboard setup github-ci` and `switchboard add github-ci` can create
  repo-aware profiles backed by `secretRef`s instead of raw client config values.
- `switchboard presets check github-ci` feels like the product's safety brain:
  it classifies real GitHub-like tool surfaces into allowed, approval-required,
  and denied buckets.
- Mandates/workspace leases are real enough for alpha. They bind repo, worktree,
  branch, profiles, lease, policy, approvals, and harness launch payloads.
- Harness surfaces are useful: `workspaceLease`, `mcpLaunch`, `tools --json`,
  `approvals --json`, `logs --json`, and `mandate report --json`.
- Runtime MCP enforcement works for allowed, denied, and approval-gated calls in
  fixture evaluation.

## Trust Breaks

- Existing direct MCP servers can remain in client config after installing
  Switchboard. This creates a bypass path and undercuts the safety promise.
- `doctor` can still report `ok` while direct non-Switchboard MCP routes remain
  available.
- Import previously redacted env-map values but could preserve token-like values
  embedded inside MCP command args. This was fixed after the eval by redacting
  secret-like arg values in import plans and imported config.
- Imported broad filesystem access, such as a filesystem MCP server pointed at
  `/`, is not yet treated as a high-risk finding.
- `mandate create --from github-ci` can be confusing after import when imported
  profile names do not match the preset default profile name.

## Missing Usefulness

- No first-class code-mode/CLI authority path yet. An agent or harness can still
  bypass Switchboard by running provider CLIs, shell scripts, SDK calls, `gh`,
  `vercel`, `stripe`, `supabase`, `git`, or arbitrary processes directly.
- `workspaceLease.mcpLaunch` omits some launch context advanced harnesses need:
  runtime dir, state/config env, daemon isolation strategy, and copy-paste-safe
  launch variants.
- MCP runtime errors need stable structured data for control loops, not only
  human-readable messages.
- Supabase/database readiness is not present. That is acceptable for current
  alpha, but should be explicit because database risk is a strong future use
  case.
- Stripe exists as `stripe-test` safety template only; it has not been proven
  against a real Stripe MCP/tool surface.

## Roadmap Consequences

The next highest-leverage work is not broad provider expansion. It is making
Switchboard's safety boundary harder to bypass and easier to perceive.

Recommended order:

1. **Bypass detection and cleanup plan**
   - Treat direct client MCP servers alongside Switchboard as a setup-incomplete
     or failed safety state.
   - Add an import/install cleanup plan that can disable or remove direct MCP
     routes with backups.
   - Show a before/after risk diff.

2. **Code-mode / CLI authority**
   - Add `switchboard run --mandate <id> -- <command>` or equivalent.
   - Check repo/worktree/branch/lease/readiness.
   - Inject only scoped secret refs.
   - Audit command, cwd, exit code, and redacted output/error metadata.

3. **Harness launch hardening**
   - Add runtime/state/config launch context to `workspaceLease`.
   - Return structured MCP error data for denied, approval-required, expired,
     and branch-mismatch states.
   - Add heartbeat/renew-before/session surfaces for long loops.

4. **Risk classification polish**
   - Flag filesystem MCP servers, root paths, prod-looking env hints, and
     live/prod provider tokens as high-risk.
   - Make preset-based mandates adapt cleanly to imported profile names.

5. **Provider proof after boundary work**
   - Prove Stripe test-mode against a real tool surface.
   - Then consider Supabase dev as the next emotionally obvious safety provider.

## Product Positioning Update

The best current public promise is:

> Switchboard finds risky agent tool access in your repo and turns it into
> scoped, expiring, auditable authority.

But that promise is only fully credible after direct MCP bypasses and code-mode
execution are covered or loudly reported as outside Switchboard's boundary.
