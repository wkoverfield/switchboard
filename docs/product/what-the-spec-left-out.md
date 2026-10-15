# What the MCP spec left out

The Model Context Protocol's 2026-07-28 revision is the most important one yet
for anyone who cares about what agents are allowed to do. Servers are now
formally OAuth 2.1 resource servers. Protected Resource Metadata is mandatory,
so a client can discover how to authenticate without guesswork. Resource
Indicators are mandatory, so a token minted for one server cannot be replayed
against another. Issuer validation and client identity got real definitions.
If you have watched agents wave raw, unscoped tokens at every server in reach,
this release is genuinely good news, and the people who pushed it deserve
credit.

It settles the first question of agent access: who is calling. It leaves open
the second question, which is the one that matters more every month: what is
this caller, right now, on this task, allowed to do?

## Three things are not in the core

Read the revision closely and three absences stand out.

**Runtime authorization.** The spec defines how a server verifies a token's
issuer, audience, and scopes. It does not define what happens between a valid
token and a dangerous call. Scope strings name broad capabilities. Whether
this agent, holding this authority, should be allowed to make this specific
call at this moment is left to the implementation.

**Sub-agent delegation.** Agentic work is becoming hierarchical. An
orchestrator plans, spawns workers, and hands each one a slice of the job.
Every one of those handoffs is also a handoff of authority, and the core spec
has nothing to say about it. There is no notion of an agent granting a
narrower version of its own access to a child, no rule that a child's
authority must fit inside its parent's, no chain that says who empowered whom.

**Audit.** Recording what agents actually called, under what authority, was
considered and moved out of the core. It may return as an extension. Until
then, the protocol standardizes the moment of access and stays silent about
the record of it.

None of these are oversights. A protocol core should be small, and the authors
drew the line deliberately. But the line means the layer above authentication
is open ground, and if you run coding agents every day, you are already
standing on it.

## Delegation is a reliability problem before it is a security problem

The usual pitch for constraining agents is fear: an agent with your GitHub
token can do anything your token can. That is true, and it is also not why
most developers will end up wanting delegation.

The practical reason is legibility. When one agent does one task, you can read
the transcript. When an orchestrator runs six workers that each spawn helpers,
and something goes wrong, the first question is not philosophical. It is:
which actor did this, and was it supposed to be able to? If every worker holds
the same god token, that question has no answer. If every worker holds a
narrow, expiring grant that traces back through its parent, the question
answers itself. Bounded authority is what makes a fleet debuggable. The safety
property falls out as a side effect.

That inversion matters for how the layer should behave. It should feel like
infrastructure that makes loops easier to run, not a compliance gate that
makes them slower.

## What a delegation layer needs

Working on this problem, I keep landing on the same small set of invariants:

1. **Attenuation.** Delegation is monotonic. A child can receive less
   authority than its parent, never more.
2. **Explicit principals.** Who issued the authority, who holds it, who
   delegated it, and the full chain between them are unambiguous.
3. **Bounded resources.** Repo, branch, tools, arguments, duration, and call
   budget can all be constrained, not just scope strings.
4. **Escalation without standing privilege.** A worker can trigger a human
   decision for one call without holding the right to make that call.
5. **Expiry and cascading revocation.** Authority dies on its own, and killing
   a parent invalidates everything below it.
6. **Evidence.** Every action ties back to the grant and the chain that
   permitted it, in a record that shows tampering.
7. **Authority lives outside the agent.** An agent can rewrite its plan or its
   code. It cannot rewrite, renew, or widen its own authority.

These map cleanly onto vocabulary the OAuth world already has.
[RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) token exchange defines
subject and actor claims and scope narrowing at each hop. In those terms: the
issuer is the local authority, the subject is the agent a grant binds, the
actor is the delegating parent, and attenuation is the rule that a child grant
validates as a strict subset of its parent. The delegation layer the spec left
out does not need new cryptography. It needs these semantics made concrete and
enforced somewhere real.

## The implementation that exists today

Switchboard is my working implementation of that layer, local-first, on the
machine where the agents run. A human grants a pass scoped to one repo,
branch, set of tools, and lease. A lead agent can hand narrower child passes
to its workers, and every child is validated as a strict subset of its parent:
fewer tools, same or shorter lease, inherited denials that cannot be removed.
Risky calls block on human approval. Expiry is automatic, revoking a parent
kills its children, and every routed call, denial, and approval lands in a
hash-chained local audit log that can be verified offline. The full
create-delegate-handoff flow is documented in the
[delegation model](../use-cases/harness-scoped-mandates.md).

The honest boundary, stated plainly because a security tool that overclaims is
worse than none: Switchboard enforces on routed paths, meaning its MCP
endpoints and its command runner. Raw shell and direct provider access bypass
it, and `switchboard scan` reports those routes rather than pretending they do
not exist. It is an authority layer, not a sandbox.

The spec's authors chose a small core, and on the evidence of this revision
they chose well. But orchestration is getting deeper faster than authorization
is getting smarter, and every layer of agents spawning agents adds handoffs
that today carry either everything or nothing. The delegation gap is where
that pressure lands. It is open ground for now, and working code beats
position papers on ground like this.

If you run fleets and want to argue about the invariants, the repo is open:
[github.com/wkoverfield/switchboard](https://github.com/wkoverfield/switchboard).
