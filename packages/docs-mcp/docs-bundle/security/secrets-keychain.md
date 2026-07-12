# Secrets and Keychain Architecture

Status: accepted for roadmap; foundation implementation started.

Last updated: 2026-06-22

## Decision

Switchboard should keep provider secrets out of repo config, agent client config,
mandate records, audit logs, and harness JSON payloads.

The recommended implementation path is:

1. Store real provider secrets in local OS-backed secret storage.
2. Let Switchboard config reference secrets by stable `secretRef` ids.
3. Let profiles bind tool/runtime configuration to those secret refs.
4. Let mandates grant temporary access to profiles and tools, not direct access
   to raw secret values.
5. Resolve secrets only inside the local Switchboard runtime when an active
   profile and mandate context permits the tool call.
6. Audit secret use by reference and context, never by value.

Provider presets should remain blocked until this foundation exists in at least
a minimal local form.

## Product Rationale

The simple product entry point is still repo-aware MCP/environment setup. A
developer should be able to install Switchboard into Codex or Claude Code and
avoid duplicated per-repo MCP config without learning the mandate model first.

But the deeper product direction is task-scoped authority. Secrets must follow
that direction. If provider presets write tokens into repo files or static agent
config, Switchboard becomes another credential sprawl surface. If profiles point
to local secret refs and mandates scope runtime access, Switchboard can later
enforce leases, approval gates, delegation limits, and audit around sensitive
provider access.

## Non-Goals

This decision does not implement:

- a cloud secret broker
- provider OAuth flows
- shared team secret sync
- remote approval service
- provider-specific presets
- automatic migration of existing agent secrets
- a general password manager

Those can be evaluated later, but the local-first shape should come first.

## Secret References

Repo and global config should use references, not raw values:

```yaml
profiles:
  github_findu:
    namespace: github_findu
    upstream:
      type: stdio
      command: github-mcp-server
      args: ["stdio"]
      env:
        GITHUB_TOKEN:
          secretRef: github/findu/dev/token
```

`secretRef` ids should be stable, human-readable names that avoid storing the
secret itself in config. A practical convention is:

```text
<provider>/<account-or-project>/<environment>/<name>
```

Examples:

- `github/findu/dev/token`
- `vercel/findu/preview/token`
- `supabase/findu-prod/prod/access-token`
- `stripe/findu-test/test/restricted-key`

The exact naming validator should be decided during implementation, but refs
should be path-like, lowercase-friendly, and safe to print in logs.

Existing profile-level `auth.ref`/`auth.key` shapes in early source planning
docs should be treated as legacy provider-level secret references, not as a
second place to store raw values. The implementation should either normalize
those fields into the same secret-ref resolver or migrate docs/config examples
to `secretRef` so provider presets have one credential path.

Literal `upstream.env` string values can remain useful for non-secret toggles,
fixture settings, and commands that expect harmless constants. Provider
credential-like values in repo config should be warned on or rejected before
provider presets ship. The implementation should draw a clear line between
non-secret env literals and provider credentials, with tests that prove
token-like profile config does not get copied into generated client config or
audit output.

## Storage Backends

Initial implementation should prefer the OS keychain available on the user's
machine:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service where available

Implementation can start with macOS if that is the dogfood platform, but the
core API should be backend-shaped from day one so Windows/Linux support is not
painted into a corner.

Environment-variable references may be useful for CI, ephemeral demos, and
developer migration, but they should be treated as an explicit fallback mode,
not the recommended steady state. If env refs are supported, generated client
config and repo config should still avoid writing raw values.

## CLI Shape

The V0 CLI is scriptable and human-usable:

```bash
switchboard secrets set github/findu/dev/token --value-stdin
switchboard secrets list
switchboard secrets remove github/findu/dev/token
switchboard secrets doctor
```

JSON surfaces use the same value-free shape:

```bash
switchboard secrets set github/findu/dev/token --value-stdin --json
switchboard secrets list --json
switchboard secrets doctor --json
```

`secrets list` should print refs and metadata only. It must not print secret
values.

Switchboard's keychain adapter allows native OS-protected backends by default:
native macOS, native Windows, and native Linux. The dependency also exposes
fallback backends such as macOS CLI, Windows PowerShell, Linux `secret-tool`,
encrypted file storage, and null storage; Switchboard refuses those for normal
secret storage. File/null/CLI fallback storage is only for tests, CI, or local
demos that explicitly set
`SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS=1`.

## Runtime Model

Secret resolution should happen at the latest practical point:

1. Load global, repo, and repo-local config.
2. Validate profile schema and secret refs without reading values.
3. Resolve active mandate context when supplied.
4. Filter profiles/tools by mandate policy.
5. Start or call the upstream profile runtime only with the secrets required for
   that permitted profile/tool path.

This keeps the steady-state rule simple: agent clients and harnesses receive an
MCP command, not provider tokens.

## Mandate Interaction

Mandates should not contain secret values.

A mandate may bind:

- profile ids
- allowed and denied namespaced tools
- approval-required tool patterns
- lease/expiry
- repo/worktree/branch context
- parent/child delegation metadata

When an active mandate is present, runtime secret use should be allowed only if
the tool call is already permitted by the mandate's profile and tool scope.
Future policy can add explicit secret-level gates, such as requiring approval
when a profile uses a production credential.

Child mandates must not be able to expand secret access beyond the parent. In
practice, this falls out of profile subset validation if secrets are only
reachable through profiles.

## Audit Rules

Audit entries may include:

- mandate id and immutable mandate uid
- profile id and namespace
- tool name
- secret refs involved, when useful for diagnosis
- backend kind, such as `keychain` or `env`
- success/failure status
- redacted error text

Audit entries must not include:

- raw secret values
- provider access tokens
- provider refresh tokens
- complete env maps
- tool arguments
- tool results
- prompts
- raw provider payloads

If a provider returns an error containing a token-like value, Switchboard should
redact it before logging, as it already does for current audit error text.

## Provider Preset Gate

Provider presets may begin only after the following are true:

- repo/global config can reference local secrets by `secretRef`
- at least one allowed local secret backend can store and resolve refs
- doctor can detect missing referenced secrets without printing values
- doctor reports backend health without printing values
- runtime secret injection is covered by tests
- audit logs remain value-redacted
- generated Codex/Claude config still contains no raw provider secrets
- mandate-scoped runtime behavior continues to work with secret-backed profiles

Until then, provider preset docs can describe intended shapes but should not ask
users to paste tokens into repo config.

## Open Implementation Questions

These should be decided in the implementation PR, not in provider preset work:

- Which Node package or native bridge should back macOS Keychain access?
- Should secret refs be global by default, repo-scoped, or support both?
- How should `switchboard secrets set` handle updates: overwrite by default or
  require `--force`?
- Should environment-variable fallback be disabled by default for production
  profile names?
- How should doctor classify a missing secret for an unused profile versus a
  mandate-bound active profile?
- Should audits log secret refs by default, or only when a verbose/debug audit
  mode exists?

## Near-Term Build Sequence

Recommended next implementation slice:

1. Add a small `SecretStore` interface in core.
2. Add config schema support for `{ secretRef: string }` env values without
   breaking literal env values already used by fixtures.
3. Add a local backend for the primary dogfood OS.
4. Add `switchboard secrets set/list/remove`.
5. Add doctor checks for missing referenced secrets.
6. Add tests proving generated client config and audit logs do not contain raw
   secret values.

Provider presets should come after that, and only for a mandate-relevant demo.
