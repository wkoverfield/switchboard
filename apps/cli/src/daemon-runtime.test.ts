import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  allowUnsafeSecretBackendsEnv,
  createApprovalRequest,
  createMandate,
  decideApprovalRequest,
  listApprovalRequests,
  markApprovalRequestStale,
  readAuditLogEntries,
  resolveAuditLogPath
} from "@switchboard-mcp/core";
import {
  handleDaemonRequest,
  invalidatePendingApprovalRequestsForDaemon
} from "./daemon-runtime.js";

const fixtureServerPath = fileURLToPath(
  new URL("../../../packages/mcp-runtime/fixtures/echo-server.mjs", import.meta.url)
);

describe("daemon runtime mandate context", () => {
  const previousStateHome = process.env.XDG_STATE_HOME;
  const previousKeyringBackend = process.env.TS_KEYRING_BACKEND;
  const previousAllowUnsafeSecretBackends =
    process.env[allowUnsafeSecretBackendsEnv];

  afterEach(() => {
    if (previousStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousStateHome;
    }
    if (previousKeyringBackend === undefined) {
      delete process.env.TS_KEYRING_BACKEND;
    } else {
      process.env.TS_KEYRING_BACKEND = previousKeyringBackend;
    }
    if (previousAllowUnsafeSecretBackends === undefined) {
      delete process.env[allowUnsafeSecretBackendsEnv];
    } else {
      process.env[allowUnsafeSecretBackendsEnv] =
        previousAllowUnsafeSecretBackends;
    }
  });

  it("marks pending approval requests stale when the daemon starts for a repo", async () => {
    const root = await makeApprovalRepo();
    await createApprovalRequest({
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_echo",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_echo",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    await invalidatePendingApprovalRequestsForDaemon(root);

    await expect(
      listApprovalRequests({ repoPath: root, mandateId: "fix-ci" })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "approval-1",
        status: "stale",
        runtimeStatus: "stale",
        decisionReason: "daemon restarted"
      })
    ]);
  });

  it("invalidates parent repo approvals from a subdirectory even when repo config is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
    process.env.XDG_STATE_HOME = join(root, "state");
    const nested = join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, ".switchboard.yaml"), "version: [");
    await createApprovalRequest({
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_echo",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_echo",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    await invalidatePendingApprovalRequestsForDaemon(nested);

    await expect(
      listApprovalRequests({ repoPath: root, mandateId: "fix-ci" })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "approval-1",
        runtimeStatus: "stale",
        decisionReason: "daemon restarted"
      })
    ]);
  });

  it("returns structured daemon errors with request ids for missing secret refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
    process.env.XDG_STATE_HOME = join(root, "state");
    process.env.TS_KEYRING_BACKEND = "null";
    process.env[allowUnsafeSecretBackendsEnv] = "1";
    await writeFile(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_findu:",
        "    provider: generic",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      env:",
        "        GITHUB_TOKEN:",
        "          secretRef: github/findu/dev/token"
      ].join("\n")
    );

    await expect(
      handleDaemonRequest(
        JSON.stringify({ id: "req-secret", type: "list_tools" }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "req-secret",
      ok: false,
      error: expect.stringContaining('secretRef "github/findu/dev/token"'),
      nextActions: ["switchboard secrets set github/findu/dev/token --value-stdin"],
      mcpError: {
        schemaVersion: "switchboard.mcp-error.v1",
        code: "missing_secret",
        message: expect.stringContaining('secretRef "github/findu/dev/token"'),
        nextActions: [
          "switchboard secrets set github/findu/dev/token --value-stdin"
        ]
      }
    });
  });

  it("rejects mandate-scoped list_tools when the daemon cwd is on another branch", async () => {
    const root = await makeMandateRepoOnWrongBranch();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "list",
          type: "list_tools",
          mandateId: "fix-ci"
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: false,
      error: expect.stringContaining(
        'pass "fix-ci" is scoped to branch "fix/ci", but current git branch is "main"'
      ),
      nextActions: ["git switch fix/ci", "switchboard pass status fix-ci"]
    });
  });

  it("rejects mandate-scoped call_tool when the daemon cwd is on another branch", async () => {
    const root = await makeMandateRepoOnWrongBranch();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_checks_list",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error: expect.stringContaining(
        'pass "fix-ci" is scoped to branch "fix/ci", but current git branch is "main"'
      ),
      nextActions: ["git switch fix/ci", "switchboard pass status fix-ci"]
    });
  });

  it("returns recovery actions for expired mandate-scoped daemon requests", async () => {
    const root = await makeExpiredMandateRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "expired",
          type: "list_tools",
          mandateId: "fix-ci"
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "expired",
      ok: false,
      error: 'pass "fix-ci" is expired',
      nextActions: [
        "switchboard pass renew fix-ci --lease 2h",
        "switchboard pass status fix-ci"
      ]
    });
  });

  it("rejects daemon-routed tool calls denied by mandate policy", async () => {
    const root = await makePolicyRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_whoami",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error: 'tool "github_findu_whoami" is not allowed by pass policy'
    });
    await expect(
      readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
    ).resolves.toMatchObject([
      {
        action: "tool_call",
        status: "error",
        mandateId: "fix-ci",
        toolName: "github_findu_whoami",
        error: 'tool "github_findu_whoami" is not allowed by mandate policy'
      }
    ]);
  });

  it("routes a request against its own cwd, not the daemon-bound cwd (multiplexing)", async () => {
    // The daemon is "bound" to an unrelated empty dir, but the request carries
    // the real repo cwd. Multiplexing means the request cwd wins, so the
    // repo's pass policy is what gets enforced.
    const repo = await makePolicyRepo();
    const unrelated = await mkdtemp(join(tmpdir(), "switchboard-daemon-other-"));

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "routed",
          type: "call_tool",
          name: "github_findu_whoami",
          mandateId: "fix-ci",
          arguments: {},
          cwd: repo
        }),
        { cwd: unrelated }
      )
    ).resolves.toMatchObject({
      id: "routed",
      ok: false,
      error: 'tool "github_findu_whoami" is not allowed by pass policy'
    });
  });

  it("filters daemon list_tools results through mandate policy", async () => {
    const root = await makePolicyRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "list",
          type: "list_tools",
          mandateId: "fix-ci"
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: true,
      tools: [expect.objectContaining({ name: "github_findu_echo" })]
    });
  });

  it("auto-binds the live pass when no mandate is given (user-level install)", async () => {
    // The repo has one active pass. An agent connecting with NO mandateId
    // should still be scoped by it, so a user-level install works without
    // threading --mandate per repo.
    const root = await makePolicyRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({ id: "auto", type: "list_tools" }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "auto",
      ok: true,
      tools: [expect.objectContaining({ name: "github_findu_echo" })]
    });
  });

  it("rejects denied daemon calls before opening upstream sessions", async () => {
    const root = await makeBrokenPolicyRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_whoami",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error: 'tool "github_findu_whoami" is not allowed by pass policy',
      mcpError: {
        schemaVersion: "switchboard.mcp-error.v1",
        code: "denied",
        message: 'tool "github_findu_whoami" is not allowed by pass policy',
        nextActions: [],
        mandateId: "fix-ci",
        toolName: "github_findu_whoami"
      }
    });
  });

  it("rejects approval-gated daemon calls with audit metadata", async () => {
    const root = await makeApprovalRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by pass gate "gate-1"; approval request approval-1 is pending; inspect it with: switchboard approvals --mandate fix-ci; approve it with: switchboard approve approval-1 --reason "<why this is safe>"; or deny it with: switchboard deny approval-1 --reason "<why this should not run>"; then retry the original github_findu_echo tool call if approved',
      mcpError: {
        schemaVersion: "switchboard.mcp-error.v1",
        code: "approval_required",
        mandateId: "fix-ci",
        toolName: "github_findu_echo",
        approvalRequestId: "approval-1",
        nextActions: [
          "switchboard approvals --mandate fix-ci",
          'switchboard approve approval-1 --reason "<why this is safe>"',
          'switchboard deny approval-1 --reason "<why this should not run>"'
        ]
      },
      approvalRequired: {
        approvalRequestId: "approval-1",
        mandateId: "fix-ci",
        mandateUid: expect.stringMatching(/^fix-ci:/),
        repoPath: root,
        branch: "fix/ci",
        task: "fix-ci",
        agentRole: "implementer",
        toolName: "github_findu_echo",
        approvalGateId: "gate-1",
        approvalGatePattern: "github_findu_echo",
        approvalGateReason: "rerunning CI changes remote state",
        approvalGateRisk: "high",
        approvalGateLabels: ["remote-state", "ci"]
      }
    });
    await expect(
      listApprovalRequests({ repoPath: root, mandateId: "fix-ci" })
    ).resolves.toMatchObject([
      {
        id: "approval-1",
        mandateUid: expect.stringMatching(/^fix-ci:/),
        runtimeStatus: "pending",
        toolName: "github_findu_echo",
        approvalGateId: "gate-1",
        approvalGateReason: "rerunning CI changes remote state",
        approvalGateRisk: "high",
        approvalGateLabels: ["remote-state", "ci"]
      }
    ]);
    await expect(
      readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
    ).resolves.toMatchObject([
      {
        action: "tool_call",
        status: "error",
        mandateId: "fix-ci",
        toolName: "github_findu_echo",
        approvalRequestId: "approval-1",
        approvalGateId: "gate-1",
        approvalGatePattern: "github_findu_echo",
        error:
          'tool "github_findu_echo" requires approval by mandate gate "gate-1"'
      }
    ]);
  });

  it("waits for approval and routes approval-gated daemon calls", async () => {
    const root = await makeApprovalRepo();
    const approval = decideWhenRequestExists(root, "approval-1", "approved");

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          approvalWaitMs: 2_000,
          arguments: { message: "hello" }
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: true,
      type: "tool_result"
    });
    await approval;
    await expect(
      readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "tool_call",
          status: "ok",
          mandateId: "fix-ci",
          toolName: "github_findu_echo",
          approvalRequestId: "approval-1"
        })
      ])
    );
  });

  it("returns denied approval decisions during approval waits", async () => {
    const root = await makeApprovalRepo();
    const denial = decideWhenRequestExists(root, "approval-1", "denied");

    const response = await handleDaemonRequest(
      JSON.stringify({
        id: "call",
        type: "call_tool",
        name: "github_findu_echo",
        mandateId: "fix-ci",
        approvalWaitMs: 1_000,
        arguments: { message: "hello" }
      }),
      { cwd: root }
    );
    expect(response).toMatchObject({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by pass gate "gate-1"; approval request approval-1 was denied.',
      mcpError: {
        schemaVersion: "switchboard.mcp-error.v1",
        code: "approval_denied",
        mandateId: "fix-ci",
        toolName: "github_findu_echo",
        approvalRequestId: "approval-1"
      }
    });
    expect(response).not.toHaveProperty("approvalRequired");
    await denial;
    await expect(
      readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "tool_call",
          status: "error",
          mandateId: "fix-ci",
          toolName: "github_findu_echo",
          approvalRequestId: "approval-1",
          error:
            'tool "github_findu_echo" requires approval by mandate gate "gate-1"; approval request approval-1 was denied.'
        })
      ])
    );
  });

  it("marks pending approval waits stale when the client disconnects", async () => {
    const root = await makeApprovalRepo();
    const controller = new AbortController();
    const abort = abortWhenRequestExists(root, "approval-1", controller);

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          approvalWaitMs: 1_000,
          arguments: { message: "hello" }
        }),
        { cwd: root },
        { signal: controller.signal }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by pass gate "gate-1"; approval request approval-1 is stale because the client disconnected.'
    });
    await abort;
    await expect(
      listApprovalRequests({ repoPath: root, mandateId: "fix-ci" })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "approval-1",
        status: "stale",
        runtimeStatus: "stale",
        decisionReason: "client disconnected during approval wait"
      })
    ]);
  });

  it("returns stale approval decisions during approval waits", async () => {
    const root = await makeApprovalRepo();
    const stale = staleWhenRequestExists(root, "approval-1");

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          approvalWaitMs: 2_000,
          arguments: { message: "hello" }
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by pass gate "gate-1"; approval request approval-1 is stale. Retry the original gated tool call to create a fresh approval request.'
    });
    await stale;
  });

  it("times out approval waits with retry guidance", async () => {
    const root = await makeApprovalRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          approvalWaitMs: 10,
          arguments: { message: "hello" }
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by pass gate "gate-1"; approval request approval-1 is pending; inspect it with: switchboard approvals --mandate fix-ci; approve it with: switchboard approve approval-1 --reason "<why this is safe>"; or deny it with: switchboard deny approval-1 --reason "<why this should not run>"; then retry the original github_findu_echo tool call if approved'
    });
  });

  it("rejects invalid approval wait daemon requests", async () => {
    const root = await makeApprovalRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          approvalWaitMs: 600_001,
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error:
        "Daemon call_tool request approvalWaitMs must be an integer from 0 to 600000."
    });
  });

  it("routes approval-gated daemon calls after a request is approved", async () => {
    const root = await makeApprovalRepo();

    await handleDaemonRequest(
      JSON.stringify({
        id: "call",
        type: "call_tool",
        name: "github_findu_echo",
        mandateId: "fix-ci",
        arguments: { message: "hello" }
      }),
      { cwd: root }
    );
    await decideApprovalRequest({
      id: "approval-1",
      status: "approved"
    });

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          arguments: { message: "hello" }
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: true,
      type: "tool_result"
    });
    await expect(
      readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "tool_call",
          status: "ok",
          mandateId: "fix-ci",
          toolName: "github_findu_echo",
          approvalRequestId: "approval-1"
        })
      ])
    );
  });

  it("keeps approval-gated tools visible in daemon list_tools results", async () => {
    const root = await makeApprovalRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "list",
          type: "list_tools",
          mandateId: "fix-ci"
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: true,
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "github_findu_echo",
          _meta: {
            switchboard: {
              approvalRequired: {
                gateId: "gate-1",
                toolPattern: "github_findu_echo",
                reason: "rerunning CI changes remote state",
                risk: "high",
                labels: ["remote-state", "ci"]
              }
            }
          }
        }),
        expect.objectContaining({ name: "github_findu_whoami" })
      ])
    });
  });

  it("rejects approval-gated daemon calls before opening upstream sessions", async () => {
    const root = await makeBrokenApprovalRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by pass gate "gate-1"; approval request approval-1 is pending; inspect it with: switchboard approvals --mandate fix-ci; approve it with: switchboard approve approval-1 --reason "<why this is safe>"; or deny it with: switchboard deny approval-1 --reason "<why this should not run>"; then retry the original github_findu_echo tool call if approved'
    });
  });
});

async function makeMandateRepoOnWrongBranch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  execFileSync("git", ["init", "-b", "main"], {
    cwd: root,
    stdio: "ignore"
  });
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    lease: "2h"
  });

  return root;
}

async function makeExpiredMandateRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  execFileSync("git", ["init", "-b", "main"], {
    cwd: root,
    stdio: "ignore"
  });
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "main",
    agentRole: "implementer",
    profiles: ["github_findu"],
    lease: "1m",
    now: () => new Date(Date.now() - 3_600_000)
  });

  return root;
}

async function decideWhenRequestExists(
  root: string,
  id: string,
  status: "approved" | "denied"
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    const requests = await listApprovalRequests({
      repoPath: root,
      mandateId: "fix-ci"
    });
    if (requests.some((request) => request.id === id)) {
      await decideApprovalRequest({
        id,
        status
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`approval request "${id}" was not created`);
}

async function abortWhenRequestExists(
  root: string,
  id: string,
  controller: AbortController
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    const requests = await listApprovalRequests({
      repoPath: root,
      mandateId: "fix-ci"
    });
    if (requests.some((request) => request.id === id)) {
      controller.abort();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`approval request "${id}" was not created`);
}

async function staleWhenRequestExists(
  root: string,
  id: string
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    const requests = await listApprovalRequests({
      repoPath: root,
      mandateId: "fix-ci"
    });
    if (requests.some((request) => request.id === id)) {
      await markApprovalRequestStale({
        id,
        reason: "another client disconnected"
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`approval request "${id}" was not created`);
}

async function makeBrokenPolicyRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      "      command: definitely-not-a-real-switchboard-command"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    allowedTools: ["github_findu_echo"],
    lease: "2h"
  });

  return root;
}

async function makeBrokenApprovalRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      "      command: definitely-not-a-real-switchboard-command"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    allowedTools: ["github_findu_*"],
    approvalRequiredTools: [
      {
        toolPattern: "github_findu_echo",
        reason: "rerunning CI changes remote state",
        risk: "high",
        labels: ["remote-state", "ci"]
      }
    ],
    lease: "2h"
  });

  return root;
}

async function makeApprovalRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - github-findu"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    allowedTools: ["github_findu_*"],
    approvalRequiredTools: [
      {
        toolPattern: "github_findu_echo",
        reason: "rerunning CI changes remote state",
        risk: "high",
        labels: ["remote-state", "ci"]
      }
    ],
    lease: "2h"
  });

  return root;
}

async function makePolicyRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - github-findu"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    allowedTools: ["github_findu_echo"],
    lease: "2h"
  });

  return root;
}
