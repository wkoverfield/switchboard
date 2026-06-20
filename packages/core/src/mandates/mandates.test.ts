import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMandate,
  listMandates,
  mandateRuntimeStatus,
  normalizeMandateId,
  parseMandateLease,
  readMandateStore,
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
      lease: "2h"
    });

    expect(mandate).toMatchObject({
      id: "fix-ci",
      task: "fix-ci",
      branch: "fix/ci",
      agentRole: "implementer",
      profiles: ["github_findu", "vercel_preview"],
      createdAt: "2026-06-19T16:00:00.000Z",
      expiresAt: "2026-06-19T18:00:00.000Z",
      runtimeStatus: "active",
      allowedTools: [],
      deniedTools: [],
      approvalGates: [],
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
