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

### Parent resolution and nesting

`switchboard mcp --mint-child` resolves the parent pass in this order:

1. `--parent <id>` when given.
2. the `SWITCHBOARD_PARENT_MANDATE` environment variable.
3. the repo's single active root pass (the one with no parent), when exactly
   one exists.

When the launcher serves a child it exports `SWITCHBOARD_PARENT_MANDATE=<the
child id>` into its environment. A deeper spawn that inherits that environment
then mints under the child, so a grandchild is a subset of the child, not the
root (`grandchild ⊆ child ⊆ root`). The child-pass engine validates that chain:
a child's profiles, tools, and lease can never exceed its immediate parent's.

## Install and remove

```
switchboard attenuation install claude     # opt in (off by default)
switchboard attenuation status claude      # report install state
switchboard attenuation uninstall claude   # remove, restoring prior settings
```

Install merges the spawn hook into user-scope Claude Code settings
(`~/.claude/settings.json`) with a timestamped backup and writes the
`scoped-worker` agent to `~/.claude/agents/scoped-worker.md`. It never touches
unrelated settings. Uninstall removes exactly what install added, restoring the
pre-install content. The agent definition is written to user scope because
file-based agent definitions in an untrusted workspace do not reliably connect
their MCP servers.

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
