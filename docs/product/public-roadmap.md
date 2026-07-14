# Switchboard Roadmap

Where Switchboard is going: the honest shipped / next / later split, kept
deliberately short.

A standing rule shapes all of it: Switchboard does not claim enforcement it
cannot provide. Anything listed under "later" is a promise of direction, not
a shipped control.

## Shipped (0.1.x, today)

- **Scoped, expiring passes** with allow/deny tool patterns, approval gates,
  branch binding, and lease expiry, enforced on every routed MCP call and on
  `switchboard run`.
- **Delegation with subset enforcement**: a lead agent can create child
  passes that are validated as strict subsets of the parent (profiles, tools,
  lease), with parent deny lists inherited.
- **Secrets in the OS keychain** behind named refs; plaintext fallbacks
  require an explicit unsafe opt-in.
- **Import and cleanup**: consolidate existing Claude/Codex MCP config into
  one guarded route, tokens out of plaintext, with backups and exact
  rollback.
- **Provider safety templates** for GitHub CI, Vercel Preview, Stripe Test,
  and Supabase Dev: recommended allow/deny/approval policy per provider.
- **Human approvals**: gated calls block until a human decides, via the CLI
  or in-client MCP elicitation.
- **Tamper-evident audit**: hash-chained local JSONL with per-entry sequence
  numbers and an out-of-band head marker, so `switchboard audit verify`
  catches tail-truncation (not just in-place edits) and audit-write failures
  are loud, not silent. Plus a local read-only dashboard for passes, denials,
  and the audit stream. External anchoring/signing stays roadmap (see Later).
- **Opt-in strict mode**: set `enforcement: strict` in `.switchboard.yaml`
  (or pass `--strict` to `switchboard mcp` / `switchboard serve`) and an
  unbound connection is denied instead of served ungoverned. No pass means an
  empty tool list and calls rejected with "no active pass; grant one with
  switchboard grant", on both the daemon and daemonless paths.
- **A written threat model** ([docs/security/threat-model.md](../security/threat-model.md))
  that states what enforcement binds and what it cannot.

## Next (in progress or near-term)

- **Third-party evidence**: named developers running the GitHub CI and
  Vercel Preview flows end to end with least-privilege tokens, plus live
  (not fixture) Stripe and Supabase runs.
- **Default-deny by default**: opt-in strict mode ships today (see Shipped),
  so no pass can already mean nothing moves. The remaining work is making
  default-deny the recommended posture with the onboarding to match, so a
  new install lands safe without reading the docs first.
- **Docs as product**: docs site, llms.txt, and the docs MCP server
  (`@switchboard-mcp/docs-mcp`) kept current with each release.

## Later (roadmap, deliberately not built yet)

These are the areas people ask about most. They are sequenced after the
single-developer product is proven, and none of them exist today:

- **Org model.** Multi-user identity, shared policy, roles, and central
  visibility. Today Switchboard is single-user and local; the `--as` role on
  a pass is a label, not an identity system. The delegation tree (human
  grants a lead agent a bounded pass, lead delegates narrower child passes,
  privileged actions escalate back to the human) is the foundation the org
  model will build on.
- **Richer policy engine.** Today policy is glob-based allow/deny/approval
  patterns evaluated per pass. Conditions, rate limits, resource-level
  scoping, and the named operating modes (inspect, guarded, autopilot,
  unrestricted) exist as template concepts only and are unenforced. They
  ship when they can be enforced, not before.
- **Enterprise surface.** SSO, RBAC, retention policies, SIEM export, audit
  signing and external anchoring, and compliance programs (SOC 2) are
  enterprise-tier work that follows the org model. The hash-chained audit
  log is the local foundation; countersigning and export sinks come with
  this tier.
- **Daemon socket hardening.** The daemon socket is protected by a per-user
  0700 directory and has no peer-credential check. Adding peer verification
  (SO_PEERCRED or platform equivalent) is planned; until then the threat
  model states the boundary plainly.
- **Windows support** beyond the existing keychain backend.

## What will stay true

- Local-first: the single-developer product keeps working with no account
  and no server.
- The audit log and pass stores stay plain, versioned, local files you can
  read without us.
- The honesty rules stay: not a sandbox, routed paths only, limits stated in
  the same breath as guarantees.
