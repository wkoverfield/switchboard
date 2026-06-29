import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createChildMandate,
  createMandate,
  evaluateMandateToolPolicy,
  listMandates,
  mandateRuntimeStatus,
  normalizeMandateId,
  parseMandateLease,
  readMandateStore,
  resolveActiveMandate,
  resolveMandateStorePath,
  updateMandateHandoff
} from "./mandates.js";

describe("mandates", () => {
  it("resolves the XDG state mandate store path", () => {
    expect(
      resolveMandateStorePath({
        env: { XDG_STATE_HOME: "/state" } as NodeJS.ProcessEnv,
        homeDir: "/home/alex"
      })
    ).toBe("/state/switchboard/mandates/mandates.json");

    expect(resolveMandateStorePath({ env: {}, homeDir: "/home/alex" })).toBe(
      "/home/alex/.local/state/switchboard/mandates/mandates.json"
    );
  });

  it("normalizes task names into stable mandate ids", () => {
    expect(normalizeMandateId(" Fix CI on PR #214 ")).toBe("fix-ci-on-pr-214");
    expect(normalizeMandateId("release_agent")).toBe("release_agent");
  });

  it("parses positive minute, hour, and day leases", () => {
    expect(parseMandateLease("30m")).toBe(30 * 60_000);
    expect(parseMandateLease("2h")).toBe(2 * 3_600_000);
    expect(parseMandateLease("1d")).toBe(86_400_000);
    expect(() => parseMandateLease("0h")).toThrow("lease must use");
    expect(() => parseMandateLease("forever")).toThrow("lease must use");
  });

  it("evaluates allow and deny tool patterns", () => {
    expect(
      evaluateMandateToolPolicy("github.findu.checks.list", {
        allowedTools: ["github.findu.*"]
      })
    ).toEqual({ allowed: true });
    expect(
      evaluateMandateToolPolicy("anything", {
        allowedTools: ["*"]
      })
    ).toEqual({ allowed: true });
    expect(
      evaluateMandateToolPolicy("github_findu_checks_list", {
        allowedTools: ["github_findu_*"]
      })
    ).toEqual({ allowed: true });
    expect(
      evaluateMandateToolPolicy("vercel_preview_logs", {
        allowedTools: ["github_findu_*"]
      })
    ).toEqual({
      allowed: false,
      reason: 'tool "vercel_preview_logs" is not allowed by mandate policy'
    });
    expect(
      evaluateMandateToolPolicy("github_findu_deploy_prod", {
        allowedTools: ["github_findu_*"],
        deniedTools: ["*_deploy_prod"]
      })
    ).toEqual({
      allowed: false,
      reason: 'tool "github_findu_deploy_prod" is denied by mandate policy'
    });
    expect(
      evaluateMandateToolPolicy("github_findu_checks_rerun", {
        allowedTools: ["github_findu_*"],
        approvalGates: [
          { id: "gate-1", toolPattern: "github_findu_checks_rerun" }
        ]
      })
    ).toEqual({
      allowed: false,
      approvalRequired: true,
      approvalGate: { id: "gate-1", toolPattern: "github_findu_checks_rerun" },
      reason:
        'tool "github_findu_checks_rerun" requires approval by mandate gate "gate-1"'
    });
    expect(
      evaluateMandateToolPolicy("github_findu_deploy_prod", {
        allowedTools: ["github_findu_read"],
        approvalGates: [
          { id: "gate-1", toolPattern: "github_findu_deploy_prod" }
        ]
      })
    ).toEqual({
      allowed: false,
      reason: 'tool "github_findu_deploy_prod" is not allowed by mandate policy'
    });
    expect(
      evaluateMandateToolPolicy("github_findu_deploy_prod", {
        allowedTools: ["github_findu_read"],
        approvalGates: [
          { id: "gate-1", toolPattern: "github_findu_deploy_prod" }
        ],
        approvedApprovalRequests: [
          {
            id: "approval-1",
            approvalGateId: "gate-1",
            toolName: "github_findu_deploy_prod"
          }
        ]
      })
    ).toEqual({
      allowed: false,
      reason: 'tool "github_findu_deploy_prod" is not allowed by mandate policy'
    });
    expect(
      evaluateMandateToolPolicy("github_findu_deploy_prod", {
        approvalGates: [
          { id: "gate-1", toolPattern: "github_findu_deploy_prod" }
        ],
        approvedApprovalRequests: [
          {
            id: "approval-1",
            approvalGateId: "gate-1",
            toolName: "github_findu_deploy_prod"
          }
        ]
      })
    ).toEqual({ allowed: true, approvalRequestId: "approval-1" });
    expect(
      evaluateMandateToolPolicy("github_findu_checks_rerun", {
        allowedTools: ["github_findu_*"],
        approvalGates: [
          {
            id: "gate-1",
            toolPattern: "github_findu_*",
            reason: "parent approval"
          },
          {
            id: "gate-2",
            toolPattern: "github_findu_checks_rerun",
            reason: "child approval",
            risk: "medium"
          }
        ]
      })
    ).toEqual({
      allowed: false,
      approvalRequired: true,
      approvalGate: {
        id: "gate-2",
        toolPattern: "github_findu_checks_rerun",
        reason: "child approval",
        risk: "medium"
      },
      reason:
        'tool "github_findu_checks_rerun" requires approval by mandate gate "gate-2"'
    });
  });

  it("creates and lists persisted mandates with runtime status", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");

    const mandate = await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath: join(root, "repo"),
      worktreePath: join(root, "repo"),
      branch: "fix/ci",
      agentRole: "implementer",
      profiles: ["github_findu", "vercel_preview", "github_findu"],
      lease: "2h",
      allowedTools: ["github_findu_*", "github_findu_*"],
      deniedTools: ["*_deploy_prod"],
      approvalRequiredTools: [
        {
          toolPattern: "github_findu_checks_rerun",
          reason: "rerunning CI changes remote state",
          risk: "high",
          labels: ["remote-state", "ci", "remote-state"]
        },
        {
          toolPattern: "github_findu_checks_rerun",
          reason: "duplicate should be ignored"
        }
      ]
    });

    expect(mandate).toMatchObject({
      id: "fix-ci",
      task: "fix-ci",
      branch: "fix/ci",
      agentRole: "implementer",
      profiles: ["github_findu", "vercel_preview"],
      allowedTools: ["github_findu_*"],
      deniedTools: ["*_deploy_prod"],
      approvalGates: [
        {
          id: "gate-1",
          toolPattern: "github_findu_checks_rerun",
          reason: "rerunning CI changes remote state",
          risk: "high",
          labels: ["remote-state", "ci"]
        }
      ],
      createdAt: "2026-06-19T16:00:00.000Z",
      expiresAt: "2026-06-19T18:00:00.000Z",
      runtimeStatus: "active",
      handoffState: "open"
    });

    expect(
      await listMandates({
        path,
        repoPath: join(root, "repo"),
        now: () => new Date("2026-06-19T16:30:00.000Z")
      })
    ).toEqual([expect.objectContaining({ id: "fix-ci", runtimeStatus: "active" })]);
    expect(await readMandateStore({ path })).toMatchObject({
      version: 1,
      mandates: [expect.objectContaining({ id: "fix-ci" })]
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("creates child mandates that cannot exceed parent authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    const repoPath = join(root, "repo");

    await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "lead",
      profiles: ["github_findu", "vercel_preview"],
      lease: "2h",
      allowedTools: ["github_findu_*"],
      deniedTools: ["*_deploy_prod"],
      approvalRequiredTools: [
        {
          toolPattern: "github_findu_checks_rerun",
          reason: "rerunning CI changes remote state"
        }
      ]
    });

    const child = await createChildMandate({
      path,
      now: () => new Date("2026-06-19T16:30:00.000Z"),
      parentId: "fix-ci",
      task: "rerun checks",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "worker",
      delegatedBy: "lead-agent",
      profiles: ["github_findu"],
      lease: "30m",
      allowedTools: ["github_findu_checks_*"],
      deniedTools: ["github_findu_checks_cancel"],
      approvalRequiredTools: [
        {
          toolPattern: "github_findu_checks_cancel",
          reason: "canceling CI changes remote state"
        }
      ]
    });

    expect(child).toMatchObject({
      id: "rerun-checks",
      parentMandateId: "fix-ci",
      delegatedBy: "lead-agent",
      delegationPath: ["fix-ci", "rerun-checks"],
      maxLeaseExpiresAt: "2026-06-19T18:00:00.000Z",
      profiles: ["github_findu"],
      allowedTools: ["github_findu_checks_*"],
      deniedTools: ["*_deploy_prod", "github_findu_checks_cancel"],
      approvalGates: [
        {
          id: "gate-1",
          toolPattern: "github_findu_checks_rerun"
        },
        {
          id: "gate-2",
          toolPattern: "github_findu_checks_cancel",
          reason: "canceling CI changes remote state"
        }
      ],
      expiresAt: "2026-06-19T17:00:00.000Z",
      runtimeStatus: "active"
    });
  });

  it("rejects child mandates that exceed parent scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    const repoPath = join(root, "repo");
    const baseChild = {
      path,
      now: () => new Date("2026-06-19T16:30:00.000Z"),
      parentId: "fix-ci",
      task: "worker",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "worker",
      profiles: ["github_findu"],
      lease: "30m"
    };

    await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "lead",
      profiles: ["github_findu"],
      lease: "1h",
      allowedTools: ["github_findu_*"]
    });

    await expect(
      createChildMandate({
        ...baseChild,
        profiles: ["github_findu", "vercel_preview"]
      })
    ).rejects.toThrow(
      "child mandate profiles exceed parent scope: vercel_preview"
    );
    await expect(
      createChildMandate({
        ...baseChild,
        task: "worker 2",
        allowedTools: ["vercel_preview_*"]
      })
    ).rejects.toThrow("child mandate allowed tools exceed parent tool scope");
    await expect(
      createChildMandate({
        ...baseChild,
        task: "worker 3",
        lease: "2h"
      })
    ).rejects.toThrow("child mandate lease cannot outlive parent mandate lease");
  });

  it("rejects child approval gates that duplicate inherited parent gates", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    const repoPath = join(root, "repo");

    await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "lead",
      profiles: ["github_findu"],
      lease: "1h",
      approvalRequiredTools: [
        {
          toolPattern: "github_findu_checks_rerun",
          reason: "parent approval reason",
          risk: "high"
        }
      ]
    });

    await expect(
      createChildMandate({
        path,
        now: () => new Date("2026-06-19T16:30:00.000Z"),
        parentId: "fix-ci",
        task: "rerun checks",
        repoPath,
        worktreePath: repoPath,
        branch: "fix/ci",
        agentRole: "worker",
        profiles: ["github_findu"],
        lease: "30m",
        approvalRequiredTools: [
          {
            toolPattern: "github_findu_checks_rerun",
            reason: "child override reason",
            risk: "medium"
          }
        ]
      })
    ).rejects.toThrow(
      'child approval gate "github_findu_checks_rerun" is already inherited from parent mandate "fix-ci"; omit the duplicate gate or choose a narrower tool pattern'
    );
  });

  it("updates mandate handoff reports and closes runtime authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    const repoPath = join(root, "repo");

    await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "lead",
      profiles: ["github_findu"],
      lease: "2h"
    });

    const closed = await updateMandateHandoff({
      path,
      now: () => new Date("2026-06-19T16:45:00.000Z"),
      id: "fix-ci",
      repoPath,
      state: "completed",
      summary: "CI is green",
      nextSteps: ["merge PR"],
      artifacts: ["https://github.com/wkoverfield/switchboard/pull/214"],
      handoffBy: "lead-agent"
    });

    expect(closed).toMatchObject({
      id: "fix-ci",
      handoffState: "completed",
      handoffSummary: "CI is green",
      handoffNextSteps: ["merge PR"],
      handoffArtifacts: ["https://github.com/wkoverfield/switchboard/pull/214"],
      handoffBy: "lead-agent",
      handoffAt: "2026-06-19T16:45:00.000Z",
      runtimeStatus: "closed"
    });
    await expect(
      resolveActiveMandate({
        path,
        repoPath,
        id: "fix-ci",
        now: () => new Date("2026-06-19T16:50:00.000Z")
      })
    ).rejects.toThrow(
      'mandate "fix-ci" is closed with handoff state "completed"'
    );
  });

  it("rejects parent handoff while child mandates remain open", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    const repoPath = join(root, "repo");

    await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "lead",
      profiles: ["github_findu"],
      lease: "2h"
    });
    await createChildMandate({
      path,
      now: () => new Date("2026-06-19T16:10:00.000Z"),
      parentId: "fix-ci",
      task: "rerun checks",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "worker",
      profiles: ["github_findu"],
      lease: "30m"
    });

    await expect(
      updateMandateHandoff({
        path,
        now: () => new Date("2026-06-19T16:20:00.000Z"),
        id: "fix-ci",
        repoPath,
        state: "completed",
        summary: "parent done"
      })
    ).rejects.toThrow(
      'cannot hand off mandate "fix-ci" while child mandates remain open: rerun-checks'
    );

    await updateMandateHandoff({
      path,
      now: () => new Date("2026-06-19T16:25:00.000Z"),
      id: "rerun-checks",
      repoPath,
      state: "completed",
      summary: "checks are green"
    });
    const parent = await updateMandateHandoff({
      path,
      now: () => new Date("2026-06-19T16:30:00.000Z"),
      id: "fix-ci",
      repoPath,
      state: "completed",
      summary: "parent done"
    });

    expect(parent.runtimeStatus).toBe("closed");
  });

  it("does not let old same-id child mandates block a newer parent", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    const repoPath = join(root, "repo");

    await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "lead",
      profiles: ["github_findu"],
      lease: "2m"
    });
    await createChildMandate({
      path,
      now: () => new Date("2026-06-19T16:00:30.000Z"),
      parentId: "fix-ci",
      task: "rerun checks",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "worker",
      profiles: ["github_findu"],
      lease: "1m"
    });

    await createMandate({
      path,
      now: () => new Date("2026-06-19T17:00:00.000Z"),
      task: "fix-ci",
      repoPath,
      worktreePath: repoPath,
      branch: "fix/ci",
      agentRole: "lead",
      profiles: ["github_findu"],
      lease: "1h"
    });

    const newerParent = await updateMandateHandoff({
      path,
      now: () => new Date("2026-06-19T17:05:00.000Z"),
      id: "fix-ci",
      repoPath,
      state: "completed",
      summary: "new parent done"
    });

    expect(newerParent).toMatchObject({
      id: "fix-ci",
      mandateUid: "fix-ci:2026-06-19T17:00:00.000Z",
      handoffState: "completed",
      runtimeStatus: "closed"
    });
  });

  it("rejects approval gate reasons with control characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");

    await expect(
      createMandate({
        path,
        task: "fix-ci",
        repoPath: join(root, "repo"),
        worktreePath: join(root, "repo"),
        branch: "fix/ci",
        agentRole: "implementer",
        profiles: ["github_findu"],
        lease: "2h",
        approvalRequiredTools: [
          {
            toolPattern: "github_findu_checks_rerun",
            reason: "looks safe\nactually deploy prod"
          }
        ]
      })
    ).rejects.toThrow(
      "approval gate reason must not contain control characters"
    );
  });

  it("rejects invalid approval gate risk and labels", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    const base = {
      path,
      task: "fix-ci",
      repoPath: join(root, "repo"),
      worktreePath: join(root, "repo"),
      branch: "fix/ci",
      agentRole: "implementer",
      profiles: ["github_findu"],
      lease: "2h"
    };

    await expect(
      createMandate({
        ...base,
        approvalRequiredTools: [
          {
            toolPattern: "github_findu_checks_rerun",
            risk: "urgent"
          }
        ]
      })
    ).rejects.toThrow(
      "approval gate risk must be one of: low, medium, high, critical"
    );

    await expect(
      createMandate({
        ...base,
        task: "fix-ci-label",
        approvalRequiredTools: [
          {
            toolPattern: "github_findu_checks_rerun",
            labels: ["Remote State"]
          }
        ]
      })
    ).rejects.toThrow(
      "approval gate labels must use lowercase letters, digits, dots, colons, underscores, or hyphens"
    );
  });

  it("serializes concurrent mandate creates without losing records", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createMandate({
          path,
          now: () => new Date("2026-06-19T16:00:00.000Z"),
          task: `task-${index}`,
          repoPath: join(root, "repo"),
          worktreePath: join(root, "repo"),
          branch: `fix/task-${index}`,
          agentRole: "implementer",
          profiles: ["github_findu"],
          lease: "2h"
        })
      )
    );

    const store = await readMandateStore({ path });
    expect(store.mandates).toHaveLength(12);
    expect(store.mandates.map((mandate) => mandate.id).sort()).toEqual(
      Array.from({ length: 12 }, (_, index) => `task-${index}`).sort()
    );
  });

  it("rejects malformed mandate stores with a schema error", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        mandates: [{ version: 1, id: "broken" }]
      })
    );

    await expect(readMandateStore({ path })).rejects.toThrow(
      "invalid Switchboard mandate store"
    );
  });

  it("rejects active duplicate ids for the same repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");
    const base = {
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath: join(root, "repo"),
      worktreePath: join(root, "repo"),
      branch: "fix/ci",
      agentRole: "implementer",
      profiles: ["github_findu"],
      lease: "2h"
    };

    await createMandate(base);

    await expect(createMandate(base)).rejects.toThrow(
      'active mandate "fix-ci" already exists'
    );
  });

  it("allows a reused id after the previous mandate expires", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");

    await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath: join(root, "repo"),
      worktreePath: join(root, "repo"),
      branch: "fix/ci",
      agentRole: "implementer",
      profiles: ["github_findu"],
      lease: "1h"
    });

    await expect(
      createMandate({
        path,
        now: () => new Date("2026-06-19T17:01:00.000Z"),
        task: "fix-ci",
        repoPath: join(root, "repo"),
        worktreePath: join(root, "repo"),
        branch: "fix/ci-2",
        agentRole: "implementer",
        profiles: ["github_findu"],
        lease: "1h"
      })
    ).resolves.toMatchObject({ id: "fix-ci", branch: "fix/ci-2" });

    await expect(
      resolveActiveMandate({
        path,
        repoPath: join(root, "repo"),
        id: "fix-ci",
        now: () => new Date("2026-06-19T17:30:00.000Z")
      })
    ).resolves.toMatchObject({ id: "fix-ci", branch: "fix/ci-2" });
  });

  it("resolves only active mandates for a repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-mandates-"));
    const path = join(root, "mandates.json");

    await createMandate({
      path,
      now: () => new Date("2026-06-19T16:00:00.000Z"),
      task: "fix-ci",
      repoPath: join(root, "repo"),
      worktreePath: join(root, "repo"),
      branch: "fix/ci",
      agentRole: "implementer",
      profiles: ["github_findu"],
      lease: "1h"
    });

    await expect(
      resolveActiveMandate({
        path,
        repoPath: join(root, "repo"),
        id: "fix-ci",
        now: () => new Date("2026-06-19T16:30:00.000Z")
      })
    ).resolves.toMatchObject({ id: "fix-ci", runtimeStatus: "active" });

    await expect(
      resolveActiveMandate({
        path,
        repoPath: join(root, "repo"),
        id: "fix-ci",
        now: () => new Date("2026-06-19T17:01:00.000Z")
      })
    ).rejects.toThrow('mandate "fix-ci" is expired');

    await expect(
      resolveActiveMandate({
        path,
        repoPath: join(root, "other-repo"),
        id: "fix-ci"
      })
    ).rejects.toThrow('mandate "fix-ci" was not found');
  });

  it("computes active and expired runtime status from expiresAt", () => {
    expect(
      mandateRuntimeStatus(
        { expiresAt: "2026-06-19T18:00:00.000Z" },
        new Date("2026-06-19T17:59:59.000Z")
      )
    ).toBe("active");
    expect(
      mandateRuntimeStatus(
        { expiresAt: "2026-06-19T18:00:00.000Z" },
        new Date("2026-06-19T18:00:00.000Z")
      )
    ).toBe("expired");
  });
});
