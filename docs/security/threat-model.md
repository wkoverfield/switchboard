# Switchboard Threat Model

Status: living document, maintained with the code it describes.
Applies to: `@switchboard-mcp/cli`, `@switchboard-mcp/core`, `@switchboard-mcp/mcp-runtime` 0.1.x.
Last full review: 2026-07-12.

This is the diligence artifact for Switchboard's security posture. It is written
to be adversarial about our own product: every claim is tied to code, and every
limit is stated as plainly as the guarantees. If you find a mismatch between
this document and the shipped behavior, that mismatch is a bug; report it via
[SECURITY.md](../../SECURITY.md).

Related documents: [audit-logs.md](audit-logs.md),
[secrets-keychain-architecture.md](secrets-keychain-architecture.md),
[trust-model.md](trust-model.md) (short posture summary that now points here).

---

## 1. What Switchboard is, in one paragraph

Switchboard is a local-first authority layer for AI coding agents. A human
grants a scoped, expiring **pass** (internally: a mandate) that names which
provider profiles and tools an agent may reach in a specific repo and branch.
Agent traffic that flows through Switchboard's MCP front door or through
`switchboard run` is checked against that pass on every call. Secrets live in
the OS keychain and are referenced by id, never stored in config or logs.
Everything is on the user's machine: there is no server, no account, and no
telemetry.

**The one-sentence honest summary: Switchboard is a policy layer over the
paths routed through it, not a sandbox around the agent process.** The rest of
this document makes that sentence precise.

## 2. System components

| Component | Code | Local state | Modes |
|---|---|---|---|
| CLI (`switchboard`) | `apps/cli/src/program.ts` | reads/writes all stores | n/a |
| Daemon (one per user, many repos) | `apps/cli/src/daemon-runtime.ts` | unix socket + `daemon.json` | dir `0o700`, state file `0o600` |
| MCP front door (stdio) | `packages/mcp-runtime/src/runtime/front-door-server.ts` | none | n/a |
| Generic router (list filter + call gate) | `packages/mcp-runtime/src/runtime/generic-router.ts` | none | n/a |
| Mandate (pass) store | `packages/core/src/mandates/mandates.ts` | JSON under XDG state | `0o600`, atomic rename, lockfile |
| Approval request store | `packages/core/src/approvals/approval-requests.ts` | `approvals/approvals.json` | `0o600`, atomic, lockfile |
| Secrets | `packages/core/src/secrets/secrets.ts` | OS keychain + value-free `secrets/index.json` | index `0o600` |
| Audit log | `packages/core/src/audit/audit-log.ts` | `logs/switchboard.jsonl` | `0o600`, append-only, hash-chained |

Network surface: none. Transports are stdio (MCP) and a per-uid unix domain
socket (daemon). Switchboard makes no outbound calls of its own; upstream MCP
servers it spawns make whatever calls those servers make.

## 3. Threat actors

Ordered by how central they are to the design.

- **A1. The routed coding agent.** The primary adversary-shaped user: an agent
  that is over-eager, misled by prompt injection in tool output or repo
  content, or simply wrong. Everything in section 4 exists to bound this
  actor. This is the actor Switchboard actually defends against.
- **A2. The same agent, off the routed paths.** An agent with raw shell
  access, a logged-in provider CLI, a browser session, or a direct MCP server
  entry in its client config. Switchboard does not control this actor; it
  detects the routes (`switchboard scan`) and tells the human. Section 5.
- **A3. A malicious or compromised upstream MCP server.** Tool descriptions
  and results are attacker-controlled input to the agent. Switchboard bounds
  the blast radius (the server only ever sees calls the pass allows, and only
  receives the secrets its own profile declares) but does not inspect or
  sanitize tool results.
- **A4. A malicious process running as the same OS user.** Out of scope, and
  it is important to say so: a same-uid process can read every store file,
  edit the mandate store, connect to the daemon socket, and (subject to OS
  keychain prompts) read secrets. Switchboard is a guardrail for agents, not
  an anti-malware boundary. See sections 7 and 9 for the specific
  consequences.
- **A5. Other local users.** Blocked by file modes: per-uid runtime dir
  `0o700`, state files `0o600`. No shared-machine multi-user features exist.
- **A6. A remote attacker.** No listening TCP surface, no account system, no
  telemetry endpoint. Remote risk arrives only through what the agent or the
  upstream servers fetch, which is A1/A3 territory.

## 4. What enforcement binds

Enforcement is **binding** on exactly two paths.

### 4.1 Routed MCP (`switchboard mcp` / `switchboard serve`)

Three independent gates, evaluated per request, in this order:

1. **List filtering.** `tools/list` omits denied tools entirely; approval-gated
   tools are listed but tagged with `_meta.switchboard.approvalRequired`
   (`generic-router.ts:63-107`). This is a UX measure, not the enforcement:
   routes are registered internally regardless, so hiding is not what blocks a
   call.
2. **Call-time re-evaluation in the router.** Every `tools/call` re-runs
   `evaluateMandateToolPolicy` before the upstream is contacted; a denied call
   is audited and thrown without ever reaching the provider
   (`generic-router.ts:109-193`).
3. **Independent re-check in the daemon.** The daemon resolves the pass fresh
   from disk on every request and re-evaluates policy again, including
   approval-gate state loaded fresh from the approvals store
   (`daemon-runtime.ts:510-827`, policy check at `:550`).

Policy semantics (`mandates.ts:325-374`): deny patterns win; a non-empty allow
list denies anything unmatched; an empty allow list allows everything not
denied or gated; glob patterns are `*` wildcards anchored at both ends.

Additional bindings on this path:

- **Branch binding.** If the repo's current git branch does not match the
  pass's branch, the daemon refuses to serve it
  (`daemon-runtime.ts:1105-1115`).
- **Profile filtering.** Upstream profiles not named by the pass are never
  mounted, so their tools do not exist on this path
  (`daemon-runtime.ts:1136-1145`).
- **Delegation subset enforcement.** A child pass cannot exceed its parent:
  profiles, tool patterns, and lease expiry are all validated as subsets, and
  parent deny lists are inherited (`mandates.ts:396-484`, `:984-1021`).
- **Approval gates.** A gated call either finds a live approved request or
  blocks; approval can arrive in-client via MCP form elicitation
  (`front-door-server.ts:180-269`) or out-of-band via `switchboard approve`.
  Decline, cancel, and elicitation failure all leave the call blocked.

### 4.2 `switchboard run`

`run` executes a provider CLI under the pass, with these checks before spawn
(`program.ts:10105-10223`):

- cwd must equal the pass's repo path (and worktree path if set); the git
  branch must match; the pass must be open and unexpired.
- **Command allowlist.** `gh`, `vercel`, `stripe`, `fixture` are recognized;
  shells and interpreters (`bash`, `sh`, `zsh`, `node`, `npm`, `python`, and
  the rest of that list) are hard-denied and cannot be enabled even by the
  pass; anything else runs only if the pass grants `run:*` or `run:<name>`.
- **Curated environment.** The child receives only the env Switchboard
  constructs: resolved `secretRef` values for the pass's profiles. It does not
  inherit arbitrary secrets from the parent environment via Switchboard's
  injection (`program.ts:10225-10260`).

`run` is a command gate and a credential scoper. It is not a filesystem or
network sandbox, and the JSON output says so on every invocation.

### 4.3 Honest mechanics of the binding paths

These are true today and easy to misunderstand; diligence readers should know
them:

- **No active pass means no policy on the daemon path.** When no pass is bound
  (none granted, or more than one matches so auto-bind refuses), the daemon
  serves all configured profiles with no tool policy
  (`daemon-runtime.ts:1124-1131`, `:1154-1187`). Enforcement is opt-in via a
  pass. "Configured profiles" is still a real boundary (nothing outside
  `.switchboard.yaml` is reachable), but within it, no pass means no deny
  list. The planned default-deny operating mode is roadmap, not shipped.
- **An empty tool policy allows everything within scope.** A pass with no
  allow, deny, or gate entries scopes profiles, branch, and lease, but not
  individual tools (`generic-router.ts:49`, `mandates.ts:341-349`).
- **The stored policy hash is informational.** `computeMandatePolicyHash`
  (`mandates.ts:306-323`) records a SHA-256 of the policy at creation, but the
  daemon enforces from the mandate fields as read from disk; it does not
  re-verify the hash at call time. A same-uid file edit therefore changes the
  effective policy (see A4 and section 7, Tampering).

## 5. What enforcement cannot bind

Stated without hedging: **Switchboard governs the routed paths above and
nothing else.**

Not bound:

- **Raw shell access.** An agent with a terminal can run anything the user can
  run. Harness-level shell approval is the applicable control, not
  Switchboard.
- **Provider CLIs invoked outside `switchboard run`**, using ambient
  credentials (`gh` with a logged-in token, `vercel` with `~/.vercel`).
- **Direct MCP servers** wired into the agent client's own config, bypassing
  the front door.
- **Browser sessions** and anything else that carries ambient user authority.
- **Ambient environment and dotfiles.** Switchboard does not strip secrets the
  user has exported globally; it avoids adding to that surface by keeping its
  own secrets in the keychain.

What exists instead of enforcement here is **detection and honesty**:

- `switchboard scan` reports bypass routes it can see in client configs:
  direct MCP servers, plaintext secret env vars, prod-looking hints, and
  write-capable surfaces (`packages/core/src/scan/scan.ts`,
  `packages/core/src/import/import-plan.ts`). Scan reads env var names, never
  values.
- The grant flow tells the user when nothing is routed: if no agent client
  goes through Switchboard, the grant output says the pass enforces nothing
  (`program.ts:2969-2979`), and the machine-readable grant carries
  `enforcement.anyClientRouted`.
- The README, SECURITY.md, and this document repeat the boundary in the same
  words: not a sandbox.

## 6. Revocation semantics

- `switchboard revoke` writes `handoffState: "cancelled"` to the mandate store
  (`program.ts:3081-3087`). The write is atomic (temp file + rename) under a
  lockfile.
- **Next-call enforcement.** The daemon holds no in-memory mandate cache; it
  re-resolves the pass from disk per request, so the first routed call after
  the store write is denied. Expiry works the same way: `resolveActiveMandate`
  refuses expired or closed passes (`mandates.ts:628-657`).
- **In-flight calls are not interrupted.** A call already past the policy gate
  and awaiting an upstream response completes. There is no cancellation signal
  from store changes to active routers. Consequence: revocation bounds future
  actions, not the one currently executing. If an in-flight action must be
  stopped, that has to happen at the provider (e.g. revoke the token).
- **Client tool lists can go stale.** The front door does not advertise
  `listChanged` and never emits `notifications/tools/list_changed`. A client
  that cached `tools/list` before a revoke still displays the old list; the
  call-time gates are what actually deny. Cosmetic staleness, real
  enforcement.
- **Daemon restart marks pending approvals stale**
  (`daemon-runtime.ts:195-203`), so an approval granted against a dead request
  cannot be replayed against a new one.
- Renewal cannot extend a pass beyond `maxLeaseExpiresAt`, and closed passes
  cannot be renewed (`mandates.ts:553-612`).

## 7. STRIDE analysis

The table names the residual risk after current mitigations. "Accepted (A4)"
means the risk collapses into the same-uid actor we explicitly do not defend
against.

### Spoofing

| Threat | Mitigation today | Residual |
|---|---|---|
| A process pretends to be the user's agent and drives the daemon socket | Socket lives in a per-uid `0o700` dir; unix domain socket unreachable off-host | **No peer authentication on the socket (no `SO_PEERCRED` check, no token).** Any same-uid process gets the full daemon protocol, including arbitrary `cwd` selection per request (`daemon-runtime.ts:349-369`). Accepted (A4) for now; peer-credential checks are on the roadmap. |
| An agent claims a role or identity it was not granted | Passes bind repo, branch, profiles; `--as` role is labeling, not authentication | Role strings are free text and should be treated as annotations in audit review, not identity. |
| A fake upstream MCP server impersonates a provider | Profiles pin the exact command/args to spawn; namespacing prevents tool-name collisions across upstreams | Supply chain of the upstream package itself (e.g. an `npx` package) is the user's trust decision, same as installing any MCP server. |

### Tampering

| Threat | Mitigation today | Residual |
|---|---|---|
| Agent edits the mandate store to widen its own pass | Store files are outside the repo (XDG state), so repo-scoped file tools do not reach them; routed paths offer no file access to the store | An agent with raw shell (A2) or any same-uid process (A4) can edit the JSON store, and the daemon will enforce the edited policy. The policy hash is recorded but not re-verified at enforcement time. Detection story: the audit log records what was exercised; the grant record and hash support after-the-fact comparison. Accepted, documented. |
| Audit log rewritten to hide activity | Hash-chained JSONL: each entry carries the hash of the previous entry; `switchboard audit verify` checks the chain. File `0o600`. | Chain verification detects in-place edits, deletions, and reordering within the retained file. It does **not** detect whole-file rewrite by an actor who recomputes the chain, tail truncation to a valid prefix, or deletion of the entire log. Countersigning/anchoring is out of scope for 0.1.x (roadmap). |
| Config or profile files edited to point at different upstreams | Repo config is reviewable in-repo (`.switchboard.yaml` diffs in PRs); imports back up prior client config before rewriting | A repo collaborator can propose config changes like any code change; review is the control. |
| Approval store tampered to fabricate an approval | `0o600`, atomic writes, lockfile; approvals matched on mandate id/uid, repo, tool, and gate; expired/stale approvals refused | Same-uid write access forges approvals. Accepted (A4). |

### Repudiation

| Threat | Mitigation today | Residual |
|---|---|---|
| "The agent never called that tool" / "that call was never denied" | Every routed call, denial, approval decision, and `run` execution writes an audit entry with timestamp, pass id, tool, status (`audit-log.ts`); hash chain gives the sequence integrity within the file | Audit is local and user-controlled; it proves sequence to the user, not to a third party. No signing, no external sink yet (roadmap: export to SIEM-shaped sinks). |
| Human denies having granted a pass | Grant records carry authority source, lease events, and immutable UIDs | Same trust domain as above: local files, same-uid editable. |

### Information disclosure

| Threat | Mitigation today | Residual |
|---|---|---|
| Secret values leak into config, logs, or agent context | Keychain-backed storage; value-free ref index; audit entries and command output pass through secret-pattern redaction (`audit-log.ts:145-181`); CI smoke proves no raw value in CLI output, MCP responses, audit logs, or reports | Redaction is pattern-based (known token shapes, key=value forms); an exotic secret format could slip a snippet. Snippets are truncated and args-only. |
| Secrets exposed to the spawned upstream | Only the `secretRef` env declared by that profile is resolved and injected at spawn (`stdio-upstream.ts:81-103`) | The upstream process can do anything with the secret it legitimately receives; choose upstream servers accordingly (A3). On Linux, a same-uid process can read a child's `/proc/<pid>/environ` (A4). |
| Import backups contain plaintext tokens that were already in client config | Backups are deliberate exact copies; docs and README tell the user to rotate those tokens | Accepted and documented: the backup preserves what was already on disk before Switchboard. |
| Scan output leaks secret values | Scan reads env var names only and says so in its output | None known. |

### Denial of service

| Threat | Mitigation today | Residual |
|---|---|---|
| Agent floods gated tools, spamming approval requests | Approval requests are deduplicated per gate/tool/pass; daemon restart stales pending ones | An agent can still generate noise; rate limiting is not implemented (roadmap, with the richer policy engine). |
| Lock starvation on the stores | Lockfile with 5s acquisition timeout, 30s stale-lock reclaim (`mandates.ts:706-756`) | Worst case is a failed command with a clear error, not a hang. |
| Daemon killed or socket removed | Clients fall back to daemonless `serve`; stale state detection recovers on next start | DoS against a local-only daemon by a same-uid actor is accepted (A4). Fail direction is closed on routed paths: no daemon means no routed calls until fallback is wired, not an open bypass. |

### Elevation of privilege

| Threat | Mitigation today | Residual |
|---|---|---|
| Child pass exceeds parent scope | Subset validation on profiles, tools, lease; parent deny lists inherited; enforced at creation (`mandates.ts:984-1021`) | None known on the routed path. |
| Agent reaches a profile the pass does not name | Unnamed profiles are never mounted on the daemon path | None known on the routed path. |
| Agent escapes `run` allowlist via an allowed CLI | Shells/interpreters hard-denied; unclassified commands need explicit `run:` grants | An allowed provider CLI is itself a capable tool (e.g. `gh` can open PRs); scope the provider token, not just the command. |
| Prompt-injected agent granted approval by a confused human | Elicitation prompt shows tool, gate, repo, branch, risk, expiry, and warns against entering secrets (`front-door-server.ts:300-345`) | Approval fatigue is real; keep gates few and high-signal. |
| No-pass state serves all configured profiles ungated | Documented here and in the README; `status` shows active passes; grant flow nudges when nothing is routed | This is the largest honest gap between the mental model ("firewall") and current behavior. Default-deny mode is on the roadmap; until then, treat "configured profile" as "reachable when no pass is active." |

## 8. Daemon socket assumptions

Explicit statement of the current socket security model:

- Path: `$XDG_RUNTIME_DIR/switchboard/daemon.sock`, falling back to
  `tmpdir()/switchboard-<uid>/daemon.sock` (`daemon-state.ts:46-63`).
- Protections: parent directory `0o700`; state file `daemon.json` `0o600`. The
  socket file itself receives no explicit chmod; the directory mode is the
  barrier.
- **There is no `SO_PEERCRED` (or equivalent) peer check and no socket
  authentication token.** The daemon trusts any connection it receives, and
  each request selects its own `cwd`, which the daemon uses to resolve config,
  passes, and audit for that repo (`daemon-runtime.ts:349-369`).
- Consequence, stated plainly: any process running as the user can connect and
  exercise any currently-active pass in any repo on the machine, and can
  trigger approval requests. It cannot forge a pass (passes exist only in the
  store, and branch binding still applies) and cannot bypass policy
  evaluation.
- This matches the design's trust boundary (A4 is out of scope) but is weaker
  than it needs to be long-term. **Socket hardening (peer credential checks)
  is a roadmap item, deliberately not shipped in 0.1.x.**

## 9. Secrets backends

- Default backend is the OS-native keychain via `cross-keychain`; allowed
  backends are `native-macos`, `native-windows`, `native-linux`
  (`secrets.ts:44-48`).
- Anything weaker (legacy backends, Secret Service, file, null) requires the
  explicit env opt-in `SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS=1`, enforced
  at backend init and again if a backend is requested via env override
  (`secrets.ts:180-217`). Without the opt-in, Switchboard refuses rather than
  degrading silently.
- The ref index (`secrets/index.json`) stores only `{ref, updatedAt}`, never
  values, written atomically at `0o600`.
- A round-trip probe (`secrets.ts:260-296`) writes and reads back a throwaway
  value at a reserved ref, because some backends initialize but cannot
  decrypt; health checks would otherwise lie.
- Transit path for a secret value: keychain, then Switchboard process memory,
  then child process environment at spawn. Values never enter the mandate
  store, approvals store, ref index, or audit log by construction, and output
  paths are redacted as defense in depth.
- Residual, stated plainly: the OS keychain protects against other users and
  at-rest theft, not against the same logged-in user's processes; keychain
  prompt behavior varies by OS and configuration. Linux same-uid processes can
  read a child's environment via procfs. Both collapse into A4.

## 10. Audit log threat surface

The audit log is the repudiation control and an attractive target, so it gets
its own accounting:

- **Write path.** Append-only JSONL at
  `$XDG_STATE_HOME/switchboard/logs/switchboard.jsonl`, dir `0o700`, file
  `0o600`. Every entry passes secret-pattern redaction before write. Audit
  failures never block the underlying call (`safeAuditLog`); availability of
  the action wins over completeness of the log, which is the right tradeoff
  for a local guardrail and the wrong one for a compliance system. Stated so
  nobody mistakes which one this is.
- **Integrity.** Entries are hash-chained: each entry records the previous
  entry's hash, and `switchboard audit verify` validates the chain and each
  entry's self-hash. Legacy (pre-chain) entries are reported as unchained
  rather than failing verification.
- **What the chain proves:** no in-place edit, insertion, deletion, or
  reordering within the retained portion of the file since the entries were
  written.
- **What the chain does not prove:** that the file was not truncated back to a
  valid prefix; that the whole file was not rewritten by an actor who
  recomputes hashes (A4 again); that entries were not simply never written
  (audit is fail-open by design, above). Remote anchoring or countersigning
  would address the first two and is out of scope for 0.1.x; it is on the
  roadmap alongside export sinks.
- **Content.** Metadata only: action, status, profile, namespace, tool, pass
  ids, gate ids, duration, truncated redacted snippets for `run`. No prompts,
  no tool arguments or results, no secret values. Logs never leave the machine
  unless the user exports them (`switchboard audit export`).

## 11. Accepted risks and open items, in one list

The short list a reviewer should walk away with:

1. **Not a sandbox.** Unrouted capability (shell, CLIs, browser, direct MCP)
   bypasses Switchboard entirely. Detection via `scan`, honesty in every
   surface. This is the product boundary, not a bug.
2. **No pass, no policy.** Absent an active pass, the daemon path serves
   configured profiles without tool policy. Default-deny mode is roadmap.
3. **Same-uid actor defeats everything local.** Store edits, socket access,
   keychain (with OS-dependent friction), audit rewrite-with-rechain. This is
   the accepted trust boundary (A4).
4. **Daemon socket is unauthenticated within the uid.** No `SO_PEERCRED`;
   `0o700` directory is the only barrier. Hardening is roadmapped and
   intentionally not in 0.1.x.
5. **Revocation is next-call, not in-flight.** An executing call completes.
6. **Policy hash is recorded, not re-verified at call time.**
7. **Audit chain does not survive whole-file rewrite or tail truncation**, and
   audit is fail-open by design. Signing/anchoring is future work.
8. **Redaction is pattern-based**, not a taint system.
9. **Approval fatigue** is a human-factors risk the gate design has to keep
   earning.
10. **Import backups can contain pre-existing plaintext tokens**; users are
    told to rotate them.

## 12. Review cadence

This document is reviewed whenever a change touches: mandate evaluation or
storage, the daemon protocol or socket, secrets backends, audit format, or any
new transport. PRs that change those areas should update the relevant section
in the same PR.
