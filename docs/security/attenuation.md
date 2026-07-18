# Spawn-time auto-attenuation

When an agent spawns a subagent, the child can run under its own attenuated
child pass automatically: its own id, its own audit trail, a lease bound to
the parent, the inherited seatbelt floor and deny lists, and cascading
revocation. Nobody has to ask and nothing has to be configured per spawn. The
human-facing top-level agent keeps its open endpoint; attenuation fires at the
agent-to-agent boundary.

This is off by default. It is installed by an explicit, reversible command and
never enabled by `switchboard setup`.

## What v1 actually enforces (read this first)

In v1 a child pass carries the **same tool set as its parent**. The tool list
is not trimmed. What is real and enforced is:

- **Distinct identity.** Each spawn mints a fresh child pass with its own id
  and its own `mandateUid`, so every actor is separable.
- **Distinct audit trail.** Every routed call the child makes is logged under
  the child's identity, so "who did what" is answerable per subagent.
- **Lease bound to the parent.** A child's lease can end no later than its
  parent's, so a child cannot outlive the delegation that created it.
- **Inherited seatbelt floor and deny lists.** The child inherits the parent's
  denied tools and the machine seatbelt still applies as an un-removable floor.
- **Cascading revocation.** Revoking a parent cancels its whole subtree: child
  and grandchild resolve as closed and can no longer bind a call.

So the value in v1 is legibility, floor, lease, and revocation, not tool
restriction. Task-scope inference and conservative tool narrowing are roadmap,
deliberately not built yet, so that turning attenuation on can never break a
wave by denying a tool a worker legitimately needs.

## The limit: policy, not a sandbox

Attenuation is an authority contract enforced at the MCP layer, not an OS
sandbox. A child that still has a shell (`Bash`) can reach around MCP scoping
by invoking a provider CLI directly. The defenses against that are the machine
seatbelt floor and the harness Bash tripwire (`switchboard hooks install
claude`), which apply to every actor regardless of pass. Treat attenuation as
defense in depth for legibility and revocation, not as containment.

## Honest limitations

Beyond the policy-not-a-sandbox limit above, v1 owns three specific gaps. None
blocks the single-root opt-in default, but each is a real property of the
current build.

1. **Deep nesting does not propagate through Claude.** A worker's sub-workers
   are scoped under the root, not under that worker, because the harness
   launches MCP servers flat from the host. Single-level attenuation is the
   guarantee; deep nesting is roadmap. See "What nesting is guaranteed" below.
2. **`mint-child` does not check parent entitlement.** The verb trusts the
   parent id it is handed (`--parent` or `SWITCHBOARD_PARENT_MANDATE`); it does
   not verify the caller is entitled to parent from that mandate. In a repo
   with a single active root pass (the default) this is moot. In a repo running
   MULTIPLE differently-scoped active root passes, an agent that can set that
   env var could mint a child of the broader root. Cross-repo parents are
   already rejected (a child must match the parent's repo, worktree, and
   branch); the open case is same-repo multi-root. An entitlement check is
   future work.
3. **Routing checks a pass's own status, not its ancestors' liveness.** A
   routed call verifies the bound pass is active; it does not walk the
   delegation chain to confirm every ancestor is still open. Cascading
   revocation is what guarantees no live orphans: revoking a parent cancels the
   whole subtree in one write. A hand-corrupted store (a child left open under
   a cancelled parent) could produce a live orphan, but that state is not
   reachable through the normal revoke path.

## How it works

Two mechanisms layer:

1. **Spawn redirect.** A `PreToolUse` hook on the `Agent`/`Task` tool rewrites
   a generic subagent spawn (`general-purpose` / `claude`) to the
   `scoped-worker` type. A specialized subagent type is left untouched.
2. **Minting launcher.** The `scoped-worker` agent definition hides the
   parent's open `mcp__switchboard` endpoint (`disallowedTools:
   mcp__switchboard`) and carries an inline MCP server whose launcher is
   `switchboard mcp --mint-child`. That verb mints a fresh child pass under
   the parent and serves the scoped `mcp --mandate <childId>` endpoint, so
   every spawn connects to its own freshly-minted, floored, audited mandate.

### Parent resolution

`switchboard mcp --mint-child` resolves the parent pass in this order:

1. `--parent <id>` when given.
2. the `SWITCHBOARD_PARENT_MANDATE` environment variable.
3. the repo's single active root pass (the one with no parent), when exactly
   one exists.

### What nesting is guaranteed (and what is not)

**Single-level attenuation is the shipped guarantee.** Through real Claude Code,
every subagent the top-level agent spawns becomes a direct child of the root
pass: its own pass id, its own audit identity, the seatbelt floor, a lease no
later than the root, and death when the root is revoked. The default resolution
(one active root pass per repo) delivers this with nothing to configure.

**Deep nesting is roadmap, not shipped.** A worker's own sub-workers being
scoped under that worker (rather than under the root) does NOT happen through
real Claude today. Claude launches every subagent's `mcp --mint-child` server
flat from the host process, so a nested spawn does not inherit the immediate
parent's id: `SWITCHBOARD_PARENT_MANDATE` set by one worker lives in that
worker's sibling MCP-server process, never in the host that launches the next
one. A nested mint therefore falls through to the repo's root pass, and the
delegation tree flattens to one level. Propagating a parent id across the
harness's flat spawn boundary (for example, an `agent_id` to mandate map in the
spawn hook) is future work.

The child-pass ENGINE does enforce the full chain: when a parent id IS supplied
(`--parent`, or an inherited env var within a single process tree), the minted
child's profiles, tools, and lease can never exceed that immediate parent's,
so `grandchild ⊆ child ⊆ root` holds wherever the id actually reaches the
launcher. The gap is propagation through Claude, not the engine.

## Install and remove

```
switchboard attenuation install claude     # opt in (off by default)
switchboard attenuation status claude      # report install state
switchboard attenuation uninstall claude   # remove, restoring prior settings
```

Install merges the spawn hook into user-scope Claude Code settings and writes
the `scoped-worker` agent to `agents/scoped-worker.md`, both under the Claude
config directory, with a timestamped backup. It never touches unrelated
settings. Uninstall removes exactly what install added, restoring the
pre-install content. The agent definition is written to user scope because
file-based agent definitions in an untrusted workspace do not reliably connect
their MCP servers.

The target directory is the one Claude Code itself reads: `CLAUDE_CONFIG_DIR`
when that environment variable is set (its `settings.json` and `agents/` live
directly under it, for example `~/.claude-b/settings.json`), falling back to
`~/.claude`. Pass `--config-dir <path>` to target a specific directory, which
overrides both the environment variable and the default. If your Claude runs
under a nonstandard `CLAUDE_CONFIG_DIR`, install without it (the resolver reads
the same variable) or pass `--config-dir` explicitly, or the hook will be
written where Claude does not read it.

## Seeing the tree: `switchboard fleet`

After a wave, `switchboard fleet` renders the delegation tree from the pass
store and the audit log: which pass spawned which, what each actor called, and
what was denied. `--json` emits the structured report.

```
Delegation tree: /path/to/repo
4 mandate(s), 3 call(s): 2 ok, 1 denied

● root  [orchestrator, active]
├─ ● scoped-root-...  [worker, active]  (parent: root)
│  │  github_findu_echo: 1 ok
│  └─ ● scoped-...  [worker, active]  (parent: scoped-root-...)
│        github_findu_echo: 1 ok
└─ ● scoped-root-...  [worker, active]  (parent: root)
      github_findu_deploy_prod: 1 DENIED (switchboard seatbelt: prod-deploy-tool)
```
