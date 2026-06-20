import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approvalRequestRuntimeStatus,
  createApprovalRequest,
  decideApprovalRequest,
  findApprovedApprovalRequest,
  listApprovalRequests,
  markApprovalRequestStale,
  markPendingApprovalRequestsStale,
  readApprovalRequestStore,
  resolveApprovalRequestStorePath
} from "./approval-requests.js";

describe("approval requests", () => {
  it("resolves the XDG state approval store path", () => {
    expect(
      resolveApprovalRequestStorePath({
        env: { XDG_STATE_HOME: "/state" } as NodeJS.ProcessEnv,
        homeDir: "/home/alex"
      })
    ).toBe("/state/switchboard/approvals/approvals.json");

    expect(
      resolveApprovalRequestStorePath({ env: {}, homeDir: "/home/alex" })
    ).toBe("/home/alex/.local/state/switchboard/approvals/approvals.json");
  });

  it("creates, lists, and dedupes pending approval requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-approvals-"));
    const path = join(root, "approvals.json");

    const request = await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:00:00.000Z"),
      mandateId: "fix-ci",
      repoPath: join(root, "repo"),
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      approvalGateRisk: "high",
      approvalGateLabels: ["remote-state", "deploy", "DEPLOY"],
      expiresAt: "2026-06-20T17:00:00.000Z"
    });

    expect(request).toMatchObject({
      id: "approval-1",
      mandateId: "fix-ci",
      status: "pending",
      runtimeStatus: "pending",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGateRisk: "high",
      approvalGateLabels: ["remote-state", "deploy"]
    });

    await expect(
      createApprovalRequest({
        path,
        now: () => new Date("2026-06-20T15:03:00.000Z"),
        mandateId: "fix-ci",
        repoPath: join(root, "repo"),
        branch: "fix/ci",
        toolName: "github_findu_delete",
        approvalGateId: "gate-2",
        approvalGatePattern: "github_findu_delete",
        approvalGateRisk: "urgent" as "high",
        expiresAt: "2026-06-20T17:00:00.000Z"
      })
    ).rejects.toThrow(
      "approval gate risk must be one of: low, medium, high, critical"
    );

    await expect(
      createApprovalRequest({
        path,
        now: () => new Date("2026-06-20T15:04:00.000Z"),
        mandateId: "fix-ci",
        repoPath: join(root, "repo"),
        branch: "fix/ci",
        toolName: "github_findu_delete",
        approvalGateId: "gate-2",
        approvalGatePattern: "github_findu_delete",
        approvalGateLabels: ["remote state"],
        expiresAt: "2026-06-20T17:00:00.000Z"
      })
    ).rejects.toThrow(
      "approval gate labels must use lowercase letters, digits, dots, colons, underscores, or hyphens"
    );

    await expect(
      createApprovalRequest({
        path,
        now: () => new Date("2026-06-20T15:01:00.000Z"),
        mandateId: "fix-ci",
        repoPath: join(root, "repo"),
        branch: "fix/ci",
        toolName: "github_findu_deploy",
        approvalGateId: "gate-1",
        approvalGatePattern: "github_findu_deploy",
        expiresAt: "2026-06-20T17:00:00.000Z"
      })
    ).resolves.toMatchObject({ id: "approval-1" });

    expect(
      await listApprovalRequests({
        path,
        repoPath: join(root, "repo"),
        mandateId: "fix-ci",
        now: () => new Date("2026-06-20T15:02:00.000Z")
      })
    ).toEqual([expect.objectContaining({ id: "approval-1" })]);
    expect(
      await listApprovalRequests({
        path,
        repoPath: join(root, "repo"),
        mandateId: "fix-ci",
        status: "pending",
        now: () => new Date("2026-06-20T15:02:00.000Z")
      })
    ).toEqual([expect.objectContaining({ id: "approval-1" })]);
    expect(await readApprovalRequestStore({ path })).toMatchObject({
      version: 1,
      requests: [expect.objectContaining({ id: "approval-1" })]
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("approves, denies, and finds fresh approved requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-approvals-"));
    const path = join(root, "approvals.json");

    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:00:00.000Z"),
      mandateId: "fix-ci",
      repoPath: join(root, "repo"),
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      expiresAt: "2026-06-20T17:00:00.000Z"
    });

    await expect(
      decideApprovalRequest({
        path,
        id: "approval-1",
        status: "approved",
        reason: "preview deploy is okay",
        now: () => new Date("2026-06-20T15:05:00.000Z")
      })
    ).resolves.toMatchObject({
      id: "approval-1",
      status: "approved",
      runtimeStatus: "approved",
      decisionReason: "preview deploy is okay"
    });

    await expect(
      findApprovedApprovalRequest({
        path,
        mandateId: "fix-ci",
        repoPath: join(root, "repo"),
        toolName: "github_findu_deploy",
        approvalGateId: "gate-1",
        now: () => new Date("2026-06-20T15:06:00.000Z")
      })
    ).resolves.toMatchObject({ id: "approval-1", runtimeStatus: "approved" });

    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:10:00.000Z"),
      mandateId: "fix-ci",
      repoPath: join(root, "repo"),
      branch: "fix/ci",
      toolName: "github_findu_delete",
      approvalGateId: "gate-2",
      approvalGatePattern: "github_findu_delete",
      expiresAt: "2026-06-20T17:00:00.000Z"
    });
    await expect(
      decideApprovalRequest({
        path,
        id: "approval-2",
        status: "denied",
        now: () => new Date("2026-06-20T15:11:00.000Z")
      })
    ).resolves.toMatchObject({ id: "approval-2", runtimeStatus: "denied" });
    await expect(
      decideApprovalRequest({
        path,
        id: "approval-2",
        status: "approved",
        now: () => new Date("2026-06-20T15:12:00.000Z")
      })
    ).rejects.toThrow('approval request "approval-2" is already denied');
  });

  it("expires pending and approved requests at their lease boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-approvals-"));
    const path = join(root, "approvals.json");

    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:00:00.000Z"),
      mandateId: "fix-ci",
      repoPath: join(root, "repo"),
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      expiresAt: "2026-06-20T15:30:00.000Z"
    });

    expect(
      approvalRequestRuntimeStatus(
        {
          status: "pending",
          expiresAt: "2026-06-20T15:30:00.000Z"
        },
        new Date("2026-06-20T15:31:00.000Z")
      )
    ).toBe("expired");
    await expect(
      decideApprovalRequest({
        path,
        id: "approval-1",
        status: "approved",
        now: () => new Date("2026-06-20T15:31:00.000Z")
      })
    ).rejects.toThrow('approval request "approval-1" is expired');
  });

  it("marks pending requests stale and prevents later approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-approvals-"));
    const path = join(root, "approvals.json");

    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:00:00.000Z"),
      mandateId: "fix-ci",
      repoPath: join(root, "repo"),
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      expiresAt: "2026-06-20T17:00:00.000Z"
    });

    await expect(
      markApprovalRequestStale({
        path,
        id: "approval-1",
        reason: "client disconnected",
        now: () => new Date("2026-06-20T15:05:00.000Z")
      })
    ).resolves.toMatchObject({
      id: "approval-1",
      status: "stale",
      runtimeStatus: "stale",
      decisionReason: "client disconnected"
    });
    await expect(
      decideApprovalRequest({
        path,
        id: "approval-1",
        status: "approved",
        now: () => new Date("2026-06-20T15:06:00.000Z")
      })
    ).rejects.toThrow('approval request "approval-1" is stale');
    await expect(
      createApprovalRequest({
        path,
        now: () => new Date("2026-06-20T15:07:00.000Z"),
        mandateId: "fix-ci",
        repoPath: join(root, "repo"),
        branch: "fix/ci",
        toolName: "github_findu_deploy",
        approvalGateId: "gate-1",
        approvalGatePattern: "github_findu_deploy",
        expiresAt: "2026-06-20T17:00:00.000Z"
      })
    ).resolves.toMatchObject({ id: "approval-2", runtimeStatus: "pending" });
    expect(
      await listApprovalRequests({
        path,
        repoPath: join(root, "repo"),
        mandateId: "fix-ci",
        status: "stale"
      })
    ).toEqual([expect.objectContaining({ id: "approval-1" })]);
  });

  it("lets stale cleanup override approved requests before reuse", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-approvals-"));
    const path = join(root, "approvals.json");

    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:00:00.000Z"),
      mandateId: "fix-ci",
      repoPath: join(root, "repo"),
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      expiresAt: "2026-06-20T17:00:00.000Z"
    });
    await decideApprovalRequest({
      path,
      id: "approval-1",
      status: "approved",
      now: () => new Date("2026-06-20T15:01:00.000Z")
    });

    await expect(
      markApprovalRequestStale({
        path,
        id: "approval-1",
        reason: "client disconnected",
        now: () => new Date("2026-06-20T15:02:00.000Z")
      })
    ).resolves.toMatchObject({
      id: "approval-1",
      status: "stale",
      runtimeStatus: "stale"
    });
    await expect(
      findApprovedApprovalRequest({
        path,
        mandateId: "fix-ci",
        repoPath: join(root, "repo"),
        toolName: "github_findu_deploy",
        approvalGateId: "gate-1",
        now: () => new Date("2026-06-20T15:03:00.000Z")
      })
    ).resolves.toBeUndefined();
  });

  it("marks only matching pending approval requests stale in batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-approvals-"));
    const path = join(root, "approvals.json");
    const repoPath = join(root, "repo");
    const otherRepoPath = join(root, "other-repo");

    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:00:00.000Z"),
      mandateId: "fix-ci",
      repoPath,
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      expiresAt: "2026-06-20T17:00:00.000Z"
    });
    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:01:00.000Z"),
      mandateId: "fix-ci",
      repoPath: otherRepoPath,
      branch: "fix/ci",
      toolName: "github_other_deploy",
      approvalGateId: "gate-2",
      approvalGatePattern: "github_other_deploy",
      expiresAt: "2026-06-20T17:00:00.000Z"
    });
    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:02:00.000Z"),
      mandateId: "fix-ci",
      repoPath,
      branch: "fix/ci",
      toolName: "github_findu_approved",
      approvalGateId: "gate-3",
      approvalGatePattern: "github_findu_approved",
      expiresAt: "2026-06-20T17:00:00.000Z"
    });
    await decideApprovalRequest({
      path,
      id: "approval-3",
      status: "approved",
      now: () => new Date("2026-06-20T15:03:00.000Z")
    });

    await expect(
      markPendingApprovalRequestsStale({
        path,
        repoPath,
        reason: "daemon restarted",
        now: () => new Date("2026-06-20T15:04:00.000Z")
      })
    ).resolves.toMatchObject([
      {
        id: "approval-1",
        status: "stale",
        runtimeStatus: "stale",
        decisionReason: "daemon restarted"
      }
    ]);
    await expect(
      listApprovalRequests({
        path,
        now: () => new Date("2026-06-20T15:05:00.000Z")
      })
    ).resolves.toMatchObject([
      { id: "approval-1", runtimeStatus: "stale" },
      { id: "approval-2", runtimeStatus: "pending" },
      { id: "approval-3", runtimeStatus: "approved" }
    ]);
  });

  it("treats malformed expiry timestamps as expired", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-approvals-"));
    const path = join(root, "approvals.json");

    await createApprovalRequest({
      path,
      now: () => new Date("2026-06-20T15:00:00.000Z"),
      mandateId: "fix-ci",
      repoPath: join(root, "repo"),
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      expiresAt: "bad"
    });
    expect(
      approvalRequestRuntimeStatus(
        { status: "approved", expiresAt: "bad" },
        new Date("2026-06-20T15:02:00.000Z")
      )
    ).toBe("expired");
    await expect(
      decideApprovalRequest({
        path,
        id: "approval-1",
        status: "approved",
        now: () => new Date("2026-06-20T15:01:00.000Z")
      })
    ).rejects.toThrow('approval request "approval-1" is expired');
    await expect(
      findApprovedApprovalRequest({
        path,
        mandateId: "fix-ci",
        repoPath: join(root, "repo"),
        toolName: "github_findu_deploy",
        approvalGateId: "gate-1",
        now: () => new Date("2026-06-20T15:02:00.000Z")
      })
    ).resolves.toBeUndefined();
    expect(
      await listApprovalRequests({
        path,
        repoPath: join(root, "repo"),
        mandateId: "fix-ci",
        status: "expired"
      })
    ).toEqual([expect.objectContaining({ id: "approval-1" })]);
  });
});
