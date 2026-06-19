import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createJsonlAuditLogger,
  readAuditLogEntries,
  resolveAuditLogPath
} from "./audit-log.js";

describe("audit log", () => {
  it("resolves the XDG state audit log path", () => {
    expect(
      resolveAuditLogPath({
        env: { XDG_STATE_HOME: "/state" } as NodeJS.ProcessEnv,
        homeDir: "/home/alex"
      })
    ).toBe("/state/switchboard/logs/switchboard.jsonl");

    expect(resolveAuditLogPath({ env: {}, homeDir: "/home/alex" })).toBe(
      "/home/alex/.local/state/switchboard/logs/switchboard.jsonl"
    );
  });

  it("writes JSONL entries with secret-like error text redacted", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({
      path,
      now: () => new Date("2026-06-19T14:00:00.000Z")
    });

    await logger.log({
      action: "profile_test",
      status: "error",
      profileName: "stripe_live",
      namespace: "stripe_live",
      durationMs: 12,
      error: "failed with token=abc123 and sk-proj-secretvalue"
    });

    await logger.log({
      action: "tool_call",
      status: "ok",
      profileName: "stripe_live",
      namespace: "stripe_live",
      toolName: "stripe_live_customers_list",
      upstreamName: "customers_list",
      durationMs: 5
    });

    const entries = await readAuditLogEntries({ path });
    expect(entries).toEqual([
      {
        version: 1,
        timestamp: "2026-06-19T14:00:00.000Z",
        action: "profile_test",
        status: "error",
        profileName: "stripe_live",
        namespace: "stripe_live",
        durationMs: 12,
        error: "failed with token=[redacted] and [redacted]"
      },
      {
        version: 1,
        timestamp: "2026-06-19T14:00:00.000Z",
        action: "tool_call",
        status: "ok",
        profileName: "stripe_live",
        namespace: "stripe_live",
        toolName: "stripe_live_customers_list",
        upstreamName: "customers_list",
        durationMs: 5
      }
    ]);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("reads only the requested tail entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({ path });

    await logger.log({ action: "profile_test", status: "ok", profileName: "one" });
    await logger.log({ action: "profile_test", status: "ok", profileName: "two" });

    expect(await readAuditLogEntries({ path, limit: 1 })).toMatchObject([
      { profileName: "two" }
    ]);
  });

  it("returns an empty list when the log file does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));

    await expect(
      readAuditLogEntries({ path: join(root, "missing.jsonl") })
    ).resolves.toEqual([]);
  });
});
