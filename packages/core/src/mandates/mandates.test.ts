import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMandate,
  evaluateMandateToolPolicy,
  listMandates,
  mandateRuntimeStatus,
  normalizeMandateId,
  parseMandateLease,
  readMandateStore,
  resolveActiveMandate,
  resolveMandateStorePath
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
    ).toMatchObject({
      allowed: false,
      approvalRequired: true,
      approvalGate: { id: "gate-1", toolPattern: "github_findu_deploy_prod" }
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
          reason: "rerunning CI changes remote state"
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
          reason: "rerunning CI changes remote state"
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
