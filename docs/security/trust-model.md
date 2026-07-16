# Trust Model

The full, adversarial security analysis lives in
[threat-model.md](threat-model.md). That document is the diligence artifact:
components, trust boundaries, STRIDE analysis, and the accepted-risks list.
This page is the short posture summary.

- **Local-first.** No server, no account, no telemetry. State lives on the
  user's machine under XDG paths with restrictive file modes.
- **Binding on routed paths.** Pass (mandate) policy is enforced on every call
  through Switchboard MCP endpoints and `switchboard run`: deny-wins tool
  policy, branch binding, profile filtering, approval gates, lease expiry, and
  child-pass subset validation.
- **Advisory everywhere else.** Raw shell, provider CLIs, direct MCP routes,
  and browser sessions bypass Switchboard. `switchboard scan` detects and
  reports those routes; Switchboard is not a sandbox and does not claim to be.
- **Secrets stay in the OS keychain.** Config and profiles hold printable
  `secretRef` ids, never values. Weaker backends require an explicit unsafe
  opt-in. Values are injected only into the spawned upstream that declared
  them.
- **Audit is local and tamper-evident.** JSONL entries are hash-chained and
  checkable with `switchboard audit verify`. Logs are metadata-only, redacted,
  and never uploaded. See [audit-logs.md](audit-logs.md).
- **The accepted trust boundary is the OS user.** A malicious same-uid process
  can defeat local controls; defending against that is explicitly out of
  scope, and the threat model says exactly what that implies.

## How the pass model maps to OAuth token exchange (RFC 8693)

The pass (mandate) model uses the same delegation semantics that
[RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) defines for OAuth token
exchange:

- **Issuer**: Switchboard, acting as the local authority that mints and
  verifies every pass on the machine where agents run.
- **Subject**: the agent a pass binds. Its identity is recorded on the
  mandate and on every audit entry its calls produce.
- **Actor**: the delegating party, either the human who ran
  `switchboard grant` or the parent agent that created a child pass. The
  delegating actor is recorded as `authority.createdBy`, and the full
  parent chain is preserved on each mandate.
- **Attenuated scope**: child passes are validated as strict subsets of
  their parent: same repo, worktree, and branch, a subset of profiles and
  tools, inherited deny lists that cannot be removed, and a lease that
  expires no later than the parent's. Delegation can only narrow
  authority, never widen it.

The envelope format is `switchboard.workspace-lease.v1` rather than an
OAuth token, because passes are minted, verified, and enforced on one
machine and never cross a network boundary. The semantics above are what
would survive a translation to token exchange if they ever needed to.

If behavior and these statements ever disagree, report it via
[SECURITY.md](../../SECURITY.md).
