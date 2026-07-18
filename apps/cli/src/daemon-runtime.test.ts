import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  allowUnsafeSecretBackendsEnv,
  clearCallRepoCache,
  createApprovalRequest,
  createDaemonState,
  createMandate,
  decideApprovalRequest,
  getDaemonStatus,
  listApprovalRequests,
  markApprovalRequestStale,
  readAuditLogEntries,
  resolveAuditLogPath,
  resolveDaemonPaths,
  strictNoPassReason,
  writeDaemonState
} from "@switchboard-mcp/core";
import {
  createIdleMonitor,
  daemonIdleTimeoutMs,
  detectOrphanedDaemons,
  handleDaemonRequest,
  invalidatePendingApprovalRequestsForDaemon,
  orphanedDaemonMaxAgeMs,
  resolveDaemonIdleTimeoutMs
} from "./daemon-runtime.js";
import { startTestDaemon } from "./daemon-test-harness.js";

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

describe("daemon runtime strict mode", () => {
  const previousStateHome = process.env.XDG_STATE_HOME;

  afterEach(() => {
    if (previousStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousStateHome;
    }
  });

  it("serves an empty tool list when strict config is set and no pass is bound", async () => {
    const root = await makeStrictRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({ id: "list", type: "list_tools" }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: true,
      tools: []
    });
  });

  it("rejects strict-mode calls with a grant-a-pass message and audits the denial", async () => {
    const root = await makeStrictRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error: strictNoPassReason,
      mcpError: {
        message: strictNoPassReason,
        toolName: "github_findu_echo"
      }
    });

    const entries = await readAuditLogEntries();
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "tool_call",
          status: "error",
          toolName: "github_findu_echo",
          error: strictNoPassReason
        })
      ])
    );
  });

  it("denies via the --strict request flag even when config is default", async () => {
    // Repo config has no `enforcement: strict`; the per-connection flag alone
    // (as sent by `switchboard mcp --strict`) must still deny.
    const root = await makeUngovernedRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({ id: "list", type: "list_tools", strict: true }),
        { cwd: root }
      )
    ).resolves.toMatchObject({ id: "list", ok: true, tools: [] });

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          strict: true,
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error: strictNoPassReason
    });
  });

  it("still serves configured profiles ungoverned when strict is off (default preserved)", async () => {
    const root = await makeUngovernedRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({ id: "list", type: "list_tools" }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: true,
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "github_findu_echo" })
      ])
    });
  });

  it("lets a bound pass govern normally even when strict is on", async () => {
    // Strict only denies when NO pass is bound. With an active pass, the repo's
    // auto-bind path still applies the pass policy instead of deny-all.
    const root = await makeStrictRepoWithPass();

    await expect(
      handleDaemonRequest(
        JSON.stringify({ id: "list", type: "list_tools" }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: true,
      tools: [expect.objectContaining({ name: "github_findu_echo" })]
    });
  });

  it("rejects a non-boolean strict flag", async () => {
    await expect(
      handleDaemonRequest(
        JSON.stringify({ id: "bad", type: "list_tools", strict: "yes" }),
        {}
      )
    ).resolves.toMatchObject({
      id: "bad",
      ok: false,
      error: "Daemon request strict must be a boolean."
    });
  });
});

async function makeStrictRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-strict-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(join(root, ".switchboard.yaml"), strictProfileConfig(true));
  return root;
}

async function makeUngovernedRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-strict-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(join(root, ".switchboard.yaml"), strictProfileConfig(false));
  return root;
}

async function makeStrictRepoWithPass(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-strict-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(join(root, ".switchboard.yaml"), strictProfileConfig(true));
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

function strictProfileConfig(strict: boolean): string {
  return [
    "version: 1",
    ...(strict ? ["enforcement: strict"] : []),
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
  ].join("\n");
}

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

describe("daemon runtime lazy repo resolution", () => {
  const previousStateHome = process.env.XDG_STATE_HOME;
  const previousConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    restoreEnv("XDG_STATE_HOME", previousStateHome);
    restoreEnv("XDG_CONFIG_HOME", previousConfigHome);
    clearCallRepoCache();
  });

  it("resolves each call against the repo its path touches, then falls back to the global default", async () => {
    // One session launched at a ~-like dir (no repo above it). The daemon is
    // bound to that home dir, but each call carries a path into a different
    // repo, so scope must follow the call, not the launch dir.
    await setupGlobalConfigEnv();
    const home = await mkdtemp(join(tmpdir(), "switchboard-lazy-home-"));
    const repoA = await makeLazyRepo({ namespace: "repo_a", label: "repo-a" });
    const repoB = await makeLazyRepo({ namespace: "repo_b", label: "repo-b" });

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "a",
          type: "call_tool",
          name: "repo_a_echo",
          arguments: { message: "hi", path: join(repoA, "src", "x.ts") }
        }),
        { cwd: home }
      )
    ).resolves.toMatchObject({
      id: "a",
      ok: true,
      type: "tool_result",
      result: { content: [{ type: "text", text: "repo-a:hi" }] }
    });

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "b",
          type: "call_tool",
          name: "repo_b_echo",
          arguments: { message: "hi", path: join(repoB, "lib", "y.ts") }
        }),
        { cwd: home }
      )
    ).resolves.toMatchObject({
      id: "b",
      ok: true,
      type: "tool_result",
      result: { content: [{ type: "text", text: "repo-b:hi" }] }
    });

    // A context-free safe call: no path arg, session not in a repo, so it
    // resolves to the machine-level global config (global profiles, no repo
    // binding).
    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "g",
          type: "call_tool",
          name: "global_echo",
          arguments: { message: "hi" }
        }),
        { cwd: home }
      )
    ).resolves.toMatchObject({
      id: "g",
      ok: true,
      type: "tool_result",
      result: { content: [{ type: "text", text: "global:hi" }] }
    });

    const entries = await readAuditLogEntries({ path: resolveAuditLogPath() });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "repo_a_echo",
          status: "ok",
          resolvedRepoPath: repoA,
          resolutionSource: "call-path"
        }),
        expect.objectContaining({
          toolName: "repo_b_echo",
          status: "ok",
          resolvedRepoPath: repoB,
          resolutionSource: "call-path"
        }),
        expect.objectContaining({
          toolName: "global_echo",
          status: "ok",
          resolutionSource: "global-default"
        })
      ])
    );
    // The global-default entry binds no repo.
    const globalEntry = entries.find(
      (entry) => entry.toolName === "global_echo"
    );
    expect(globalEntry?.resolvedRepoPath).toBeUndefined();
  });

  it("keeps the seatbelt floor on for a context-free call (global default)", async () => {
    await setupGlobalConfigEnv();
    const home = await mkdtemp(join(tmpdir(), "switchboard-lazy-home-"));

    const denied = await handleDaemonRequest(
      JSON.stringify({
        id: "cf",
        type: "call_tool",
        name: "global_deploy_prod",
        arguments: { message: "ship it" }
      }),
      { cwd: home }
    );
    expect(denied).toMatchObject({
      id: "cf",
      ok: false,
      error: expect.stringContaining("switchboard seatbelt: prod-deploy-tool")
    });

    const entries = await readAuditLogEntries({ path: resolveAuditLogPath() });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "global_deploy_prod",
          status: "error",
          resolutionSource: "global-default",
          error: expect.stringContaining("switchboard seatbelt:")
        })
      ])
    );
  });

  it("honors the session cwd for a context-free call when launched inside a repo", async () => {
    await setupGlobalConfigEnv();
    const repoC = await makeLazyRepo({ namespace: "repo_c", label: "repo-c" });

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "sc",
          type: "call_tool",
          name: "repo_c_echo",
          arguments: { message: "hi" }
        }),
        { cwd: repoC }
      )
    ).resolves.toMatchObject({
      id: "sc",
      ok: true,
      type: "tool_result",
      result: { content: [{ type: "text", text: "repo-c:hi" }] }
    });

    const entries = await readAuditLogEntries({ path: resolveAuditLogPath() });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "repo_c_echo",
          status: "ok",
          resolvedRepoPath: repoC,
          resolutionSource: "session-cwd"
        })
      ])
    );
  });

  it("cannot let a resolved repo weaken the seatbelt floor (repo seatbelt: off ignored)", async () => {
    // The call resolves to repo C by its path. Repo C's own config says
    // `seatbelt: off`, but the floor is machine-scoped, so the catastrophe
    // still denies.
    await setupGlobalConfigEnv();
    const home = await mkdtemp(join(tmpdir(), "switchboard-lazy-home-"));
    const repoC = await makeLazyRepo({
      namespace: "repo_c",
      label: "repo-c",
      seatbeltOff: true,
      deployTool: true
    });

    const denied = await handleDaemonRequest(
      JSON.stringify({
        id: "floor",
        type: "call_tool",
        name: "repo_c_deploy_prod",
        arguments: { message: "ship it", path: join(repoC, "deploy.ts") }
      }),
      { cwd: home }
    );
    expect(denied).toMatchObject({
      id: "floor",
      ok: false,
      error: expect.stringContaining("switchboard seatbelt: prod-deploy-tool")
    });

    const entries = await readAuditLogEntries({ path: resolveAuditLogPath() });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "repo_c_deploy_prod",
          status: "error",
          resolvedRepoPath: repoC,
          resolutionSource: "call-path",
          error: expect.stringContaining("switchboard seatbelt:")
        })
      ])
    );
  });

  it("keeps a strict session's floor when a path arg redirects to a permissive repo", async () => {
    // The session is in a strict repo with no pass, so every call is denied.
    // An agent adds a path arg pointing into a permissive repo to try to escape
    // that; the only-strengthen gate keeps the strict floor.
    await setupGlobalConfigEnv();
    const strictRepo = await makeLazyRepo({
      namespace: "svc",
      label: "svc",
      strict: true
    });
    const permissiveRepo = await makeLazyRepo({
      namespace: "svc",
      label: "PERMISSIVE"
    });

    const control = await handleDaemonRequest(
      JSON.stringify({
        id: "ctl",
        type: "call_tool",
        name: "svc_echo",
        arguments: { message: "hi" }
      }),
      { cwd: strictRepo }
    );
    expect(control).toMatchObject({ id: "ctl", ok: false });
    expect(control.error).toBe(strictNoPassReason);

    const attack = await handleDaemonRequest(
      JSON.stringify({
        id: "atk",
        type: "call_tool",
        name: "svc_echo",
        arguments: { message: "hi", path: join(permissiveRepo, "x.ts") }
      }),
      { cwd: strictRepo }
    );
    expect(attack).toMatchObject({ id: "atk", ok: false });
    expect(attack.error).toBe(strictNoPassReason);
  });

  it("keeps a session pass's tool scope when a path arg redirects to a permissive repo", async () => {
    // Session pass allows only svc_echo; svc_whoami is out of scope. A path arg
    // into a permissive repo (no pass) must not lift the pass scope.
    await setupGlobalConfigEnv();
    const passRepo = await makeLazyRepo({ namespace: "svc", label: "svc" });
    await createMandate({
      task: "scoped",
      repoPath: passRepo,
      worktreePath: passRepo,
      branch: "-",
      agentRole: "implementer",
      profiles: ["svc"],
      allowedTools: ["svc_echo"],
      lease: "2h"
    });
    const permissiveRepo = await makeLazyRepo({
      namespace: "svc",
      label: "PERMISSIVE"
    });

    const control = await handleDaemonRequest(
      JSON.stringify({
        id: "pc",
        type: "call_tool",
        name: "svc_whoami",
        arguments: {}
      }),
      { cwd: passRepo }
    );
    expect(control).toMatchObject({
      id: "pc",
      ok: false,
      error: 'tool "svc_whoami" is not allowed by pass policy'
    });

    const attack = await handleDaemonRequest(
      JSON.stringify({
        id: "pa",
        type: "call_tool",
        name: "svc_whoami",
        arguments: { path: join(permissiveRepo, "x.ts") }
      }),
      { cwd: passRepo }
    );
    expect(attack).toMatchObject({
      id: "pa",
      ok: false,
      error: 'tool "svc_whoami" is not allowed by pass policy'
    });

    // A tool the session pass DOES allow still routes through the redirect.
    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "pe",
          type: "call_tool",
          name: "svc_echo",
          arguments: { message: "hi", path: join(permissiveRepo, "x.ts") }
        }),
        { cwd: passRepo }
      )
    ).resolves.toMatchObject({ id: "pe", ok: true, type: "tool_result" });
  });

  it("applies the resolved repo's own pass when a permissive session redirects into it (not a downgrade)", async () => {
    // The legitimate case: a session opened at ~ (no pass, permissive floor)
    // makes a call into a repo whose pass allows only its echo tool. That pass
    // fully governs the call; the permissive session adds nothing to lift.
    await setupGlobalConfigEnv();
    const home = await mkdtemp(join(tmpdir(), "switchboard-lazy-home-"));
    const repoA = await makeLazyRepo({
      namespace: "repo_a",
      label: "repo-a",
      strict: true
    });
    await createMandate({
      task: "scoped-a",
      repoPath: repoA,
      worktreePath: repoA,
      branch: "-",
      agentRole: "implementer",
      profiles: ["repo_a"],
      allowedTools: ["repo_a_echo"],
      lease: "2h"
    });

    // repo A's pass allows echo: the call runs against repo A.
    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "ok",
          type: "call_tool",
          name: "repo_a_echo",
          arguments: { message: "hi", path: join(repoA, "x.ts") }
        }),
        { cwd: home }
      )
    ).resolves.toMatchObject({
      id: "ok",
      ok: true,
      type: "tool_result",
      result: { content: [{ type: "text", text: "repo-a:hi" }] }
    });

    // repo A's pass denies whoami: the call is denied by A's pass, not the
    // permissive session.
    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "no",
          type: "call_tool",
          name: "repo_a_whoami",
          arguments: { path: join(repoA, "x.ts") }
        }),
        { cwd: home }
      )
    ).resolves.toMatchObject({
      id: "no",
      ok: false,
      error: 'tool "repo_a_whoami" is not allowed by pass policy'
    });
  });

  it("resolves multi-repo path args deterministically regardless of key order", async () => {
    // Two path args into two different repos are ambiguous. Resolution must not
    // depend on argument key order (an agent could otherwise steer to the
    // weaker repo); it refuses to redirect and falls back to the session, whose
    // strict floor then denies both orderings identically.
    await setupGlobalConfigEnv();
    const strictSession = await makeLazyRepo({
      namespace: "svc",
      label: "svc",
      strict: true
    });
    const repoP = await makeLazyRepo({ namespace: "svc", label: "P" });
    const repoR = await makeLazyRepo({ namespace: "svc", label: "R" });

    const order1 = await handleDaemonRequest(
      JSON.stringify({
        id: "o1",
        type: "call_tool",
        name: "svc_echo",
        arguments: {
          repository: join(repoR, "a.ts"),
          path: join(repoP, "b.ts")
        }
      }),
      { cwd: strictSession }
    );
    const order2 = await handleDaemonRequest(
      JSON.stringify({
        id: "o2",
        type: "call_tool",
        name: "svc_echo",
        arguments: {
          path: join(repoP, "b.ts"),
          repository: join(repoR, "a.ts")
        }
      }),
      { cwd: strictSession }
    );
    expect(order1).toMatchObject({ id: "o1", ok: false });
    expect(order2).toMatchObject({ id: "o2", ok: false });
    expect(order1.error).toBe(strictNoPassReason);
    expect(order2.error).toBe(order1.error);
  });
});

describe("daemon runtime ambient seatbelt", () => {
  const previousStateHome = process.env.XDG_STATE_HOME;
  const previousConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    restoreEnv("XDG_STATE_HOME", previousStateHome);
    restoreEnv("XDG_CONFIG_HOME", previousConfigHome);
  });

  it("denies a catastrophe-shaped call with no pass, then allows the approved retry", async () => {
    const root = await makeSeatbeltRepo();

    const denied = await handleDaemonRequest(
      JSON.stringify({
        id: "call",
        type: "call_tool",
        name: "github_findu_deploy_prod",
        arguments: { message: "ship it" }
      }),
      { cwd: root }
    );
    expect(denied).toMatchObject({
      id: "call",
      ok: false,
      error: expect.stringContaining("switchboard seatbelt: prod-deploy-tool"),
      mcpError: {
        code: "approval_required",
        message: expect.stringContaining(
          'switchboard approve approval-1 --reason "<why this is safe>"'
        )
      }
    });
    expect(denied.error).toContain("production deploy tool call");

    await expect(
      listApprovalRequests({ repoPath: root, mandateId: "seatbelt" })
    ).resolves.toMatchObject([
      {
        id: "approval-1",
        mandateId: "seatbelt",
        toolName: "github_findu_deploy_prod",
        approvalGateId: "seatbelt:prod-deploy-tool",
        approvalGateRisk: "critical",
        approvalGateLabels: ["seatbelt"],
        runtimeStatus: "pending"
      }
    ]);

    await decideApprovalRequest({ id: "approval-1", status: "approved" });

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "retry",
          type: "call_tool",
          name: "github_findu_deploy_prod",
          arguments: { message: "ship it" }
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({ id: "retry", ok: true, type: "tool_result" });

    const entries = await readAuditLogEntries({ path: resolveAuditLogPath() });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "tool_call",
          status: "error",
          toolName: "github_findu_deploy_prod",
          mandateId: "seatbelt",
          approvalRequestId: "approval-1",
          approvalGateId: "seatbelt:prod-deploy-tool",
          error: expect.stringContaining(
            "switchboard seatbelt: prod-deploy-tool"
          )
        }),
        expect.objectContaining({
          action: "tool_call",
          status: "ok",
          toolName: "github_findu_deploy_prod"
        })
      ])
    );
  });

  it("leaves safe calls untouched with no pass bound", async () => {
    const root = await makeSeatbeltRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "safe",
          type: "call_tool",
          name: "github_findu_echo",
          arguments: { message: "deploy the app later" }
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({ id: "safe", ok: true, type: "tool_result" });
  });

  it("stays under an active pass as an un-removable floor", async () => {
    const root = await makeSeatbeltRepo();
    await createMandate({
      task: "ship",
      repoPath: root,
      worktreePath: root,
      branch: "feat/ship",
      agentRole: "implementer",
      profiles: ["github_findu"],
      allowedTools: ["github_findu_*"],
      lease: "2h"
    });

    const denied = await handleDaemonRequest(
      JSON.stringify({
        id: "call",
        type: "call_tool",
        name: "github_findu_deploy_prod",
        mandateId: "ship",
        arguments: {}
      }),
      { cwd: root }
    );
    expect(denied).toMatchObject({
      id: "call",
      ok: false,
      error: expect.stringContaining("switchboard seatbelt: prod-deploy-tool")
    });
    await expect(
      listApprovalRequests({ repoPath: root, mandateId: "ship" })
    ).resolves.toMatchObject([
      {
        id: "approval-1",
        mandateId: "ship",
        approvalGateId: "seatbelt:prod-deploy-tool",
        runtimeStatus: "pending"
      }
    ]);

    await decideApprovalRequest({ id: "approval-1", status: "approved" });
    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "retry",
          type: "call_tool",
          name: "github_findu_deploy_prod",
          mandateId: "ship",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({ id: "retry", ok: true, type: "tool_result" });
  });

  it("respects seatbelt: off in the global config", async () => {
    const root = await makeSeatbeltRepo();
    await writeGlobalSeatbeltConfig(root, "version: 1\nseatbelt: off\n");

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "off",
          type: "call_tool",
          name: "github_findu_deploy_prod",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({ id: "off", ok: true, type: "tool_result" });
  });

  it("ignores a repo-level seatbelt: off (the floor is machine-scoped)", async () => {
    const root = await makeSeatbeltRepo({ repoSeatbeltOff: true });

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "repo-off",
          type: "call_tool",
          name: "github_findu_deploy_prod",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "repo-off",
      ok: false,
      error: expect.stringContaining("switchboard seatbelt:")
    });
  });

  it("respects the per-request --no-seatbelt opt-out", async () => {
    const root = await makeSeatbeltRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "flag",
          type: "call_tool",
          name: "github_findu_deploy_prod",
          seatbelt: false,
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({ id: "flag", ok: true, type: "tool_result" });
  });

  it("rejects a non-boolean seatbelt flag", async () => {
    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "bad",
          type: "call_tool",
          name: "x",
          seatbelt: "off"
        }),
        {}
      )
    ).resolves.toMatchObject({
      id: "bad",
      ok: false,
      error: "Daemon request seatbelt must be a boolean."
    });
  });
});

describe("daemon idle self-termination", () => {
  it("names the idle timeout at sixty minutes", () => {
    expect(daemonIdleTimeoutMs).toBe(60 * 60_000);
    expect(resolveDaemonIdleTimeoutMs({})).toBe(daemonIdleTimeoutMs);
    expect(
      resolveDaemonIdleTimeoutMs({ SWITCHBOARD_DAEMON_IDLE_TIMEOUT_MS: "250" })
    ).toBe(250);
    expect(
      resolveDaemonIdleTimeoutMs({ SWITCHBOARD_DAEMON_IDLE_TIMEOUT_MS: "nope" })
    ).toBe(daemonIdleTimeoutMs);
  });

  it("tracks idleness against an injected clock", () => {
    let nowMs = 1_000;
    const monitor = createIdleMonitor({ timeoutMs: 100, now: () => nowMs });
    expect(monitor.isIdle()).toBe(false);
    nowMs += 99;
    expect(monitor.isIdle()).toBe(false);
    nowMs += 1;
    expect(monitor.isIdle()).toBe(true);
    monitor.touch();
    expect(monitor.isIdle()).toBe(false);
    nowMs += 100;
    expect(monitor.isIdle()).toBe(true);
  });

  it("exits cleanly and removes its state after the idle timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-idle-"));
    process.env.XDG_STATE_HOME = join(root, "state");
    const runtimeDir = join(root, "runtime");
    const daemon = await startTestDaemon({
      runtimeDir,
      cwd: root,
      idleTimeoutMs: 100
    });

    await daemon.done;
    const paths = resolveDaemonPaths({ runtimeDir });
    expect(getDaemonStatus(paths).state).toBe("not-running");
  });
});

describe("orphaned daemon detection", () => {
  it("flags a tracked daemon whose repo path was deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-orphan-"));
    const runtimeDir = join(root, "runtime");
    const paths = resolveDaemonPaths({ runtimeDir });
    await writeDaemonState(
      createDaemonState({
        pid: process.pid,
        socketPath: paths.socketPath,
        cwd: join(root, "deleted-repo")
      }),
      paths
    );
    await writeFile(paths.socketPath, "");

    const findings = await detectOrphanedDaemons({
      runtimeDir,
      listProcesses: () => []
    });
    expect(findings).toMatchObject([
      { pid: process.pid, reason: "repo-path-missing" }
    ]);
  });

  it("flags a tracked daemon running past the age limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-orphan-"));
    const runtimeDir = join(root, "runtime");
    const paths = resolveDaemonPaths({ runtimeDir });
    await writeDaemonState(
      createDaemonState({
        pid: process.pid,
        socketPath: paths.socketPath,
        cwd: root,
        startedAt: new Date(Date.now() - orphanedDaemonMaxAgeMs - 60_000)
      }),
      paths
    );
    await writeFile(paths.socketPath, "");

    const findings = await detectOrphanedDaemons({
      runtimeDir,
      listProcesses: () => []
    });
    expect(findings).toMatchObject([
      { pid: process.pid, reason: "over-max-age" }
    ]);
  });

  it("flags daemon processes whose runtime dir no longer exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-orphan-"));
    const runtimeDir = join(root, "runtime");

    const findings = await detectOrphanedDaemons({
      runtimeDir,
      listProcesses: () => [
        {
          pid: 4242,
          command:
            "node /repo/apps/cli/dist/index.js daemon run --runtime-dir /tmp/deleted-sandbox/runtime"
        },
        {
          pid: 4243,
          command: `node /repo/apps/cli/dist/index.js daemon run --runtime-dir ${root}`
        }
      ]
    });
    expect(findings).toMatchObject([
      {
        pid: 4242,
        reason: "runtime-dir-missing",
        runtimeDir: "/tmp/deleted-sandbox/runtime"
      }
    ]);
  });

  it("reports nothing for a healthy state", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-orphan-"));
    const runtimeDir = join(root, "runtime");
    await expect(
      detectOrphanedDaemons({ runtimeDir, listProcesses: () => [] })
    ).resolves.toEqual([]);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function makeSeatbeltRepo(options: {
  repoSeatbeltOff?: boolean;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-seatbelt-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  // An empty sandboxed config home isolates the test from any real machine
  // config; the built-in seatbelt defaults apply.
  process.env.XDG_CONFIG_HOME = join(root, "config");
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      ...(options.repoSeatbeltOff ? ["seatbelt: off"] : []),
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - github-findu",
      '        - ""',
      '        - ""',
      "        - deploy_prod"
    ].join("\n")
  );
  return root;
}

async function writeGlobalSeatbeltConfig(
  root: string,
  content: string
): Promise<void> {
  const configDir = join(root, "config", "switchboard");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "config.yaml"), content);
}

// Isolate XDG_STATE_HOME and XDG_CONFIG_HOME under one sandbox and seed a
// machine-level global config that defines a `global` profile (with a
// deploy_prod tool for floor tests). The seatbelt is left at its default (on).
async function setupGlobalConfigEnv(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-lazy-base-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  process.env.XDG_CONFIG_HOME = join(root, "config");
  const configDir = join(root, "config", "switchboard");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "config.yaml"),
    lazyProfileConfig({ namespace: "global", label: "global", deployTool: true })
  );
  return root;
}

// A repo whose `.switchboard.yaml` binds one namespaced echo-server profile.
async function makeLazyRepo(options: {
  namespace: string;
  label: string;
  seatbeltOff?: boolean;
  deployTool?: boolean;
  strict?: boolean;
}): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), `switchboard-lazy-${options.namespace}-`)
  );
  await writeFile(join(root, ".switchboard.yaml"), lazyProfileConfig(options));
  return root;
}

function lazyProfileConfig(options: {
  namespace: string;
  label: string;
  seatbeltOff?: boolean;
  deployTool?: boolean;
  strict?: boolean;
}): string {
  return [
    "version: 1",
    ...(options.strict ? ["enforcement: strict"] : []),
    ...(options.seatbeltOff ? ["seatbelt: off"] : []),
    "profiles:",
    `  ${options.namespace}:`,
    "    provider: generic",
    `    namespace: ${options.namespace}`,
    "    upstream:",
    "      type: stdio",
    `      command: ${JSON.stringify(process.execPath)}`,
    "      args:",
    `        - ${JSON.stringify(fixtureServerPath)}`,
    `        - ${options.label}`,
    ...(options.deployTool
      ? ['        - ""', '        - ""', "        - deploy_prod"]
      : [])
  ].join("\n");
}
