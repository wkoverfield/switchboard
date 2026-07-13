import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditLogChainGenesis,
  computeAuditLogEntryHash,
  createJsonlAuditLogger,
  readAuditLogEntries,
  resolveAuditLogPath,
  safeAuditLog,
  verifyAuditLog
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
      error:
        'Authorization: Bearer abc.def token=abc123 "apiKey":"json-secret" https://user:pass@example.com and sk-proj-secretvalue ghp_secretvalue xoxb-secretvalue'
    });

    await logger.log({
      action: "tool_call",
      status: "ok",
      profileName: "stripe_live",
      namespace: "stripe_live",
      toolName: "stripe_live_customers_list",
      upstreamName: "customers_list",
      mandateId: "fix-ci",
      durationMs: 5
    });

    const entries = await readAuditLogEntries({ path });
    expect(entries).toMatchObject([
      {
        version: 1,
        timestamp: "2026-06-19T14:00:00.000Z",
        action: "profile_test",
        status: "error",
        profileName: "stripe_live",
        namespace: "stripe_live",
        durationMs: 12,
        error:
          'Authorization: Bearer [redacted] token=[redacted] "apiKey":"[redacted]" https://[redacted]@example.com and [redacted] [redacted] [redacted]',
        prevHash: auditLogChainGenesis
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
        mandateId: "fix-ci",
        durationMs: 5
      }
    ]);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("hash-chains entries so each entry links to the previous one", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({ path });

    await logger.log({ action: "profile_test", status: "ok", profileName: "one" });
    await logger.log({ action: "profile_test", status: "ok", profileName: "two" });
    await logger.log({ action: "profile_test", status: "ok", profileName: "three" });

    const entries = await readAuditLogEntries({ path });
    expect(entries[0]?.prevHash).toBe(auditLogChainGenesis);
    expect(entries[1]?.prevHash).toBe(entries[0]?.hash);
    expect(entries[2]?.prevHash).toBe(entries[1]?.hash);

    for (const entry of entries) {
      const { hash, ...unhashed } = entry;
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(hash).toBe(computeAuditLogEntryHash(unhashed));
    }
  });

  it("verifies an intact chain, counting legacy entries without failing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    await writeFile(
      path,
      `${JSON.stringify({
        version: 1,
        timestamp: "2026-06-19T13:00:00.000Z",
        action: "profile_test",
        status: "ok",
        profileName: "legacy"
      })}\n`
    );
    const logger = createJsonlAuditLogger({ path });
    await logger.log({ action: "profile_test", status: "ok", profileName: "one" });
    await logger.log({ action: "profile_test", status: "ok", profileName: "two" });

    const verification = await verifyAuditLog({ path });
    expect(verification).toMatchObject({
      ok: true,
      totalLines: 3,
      chainedEntries: 2,
      legacyEntries: 1,
      failures: []
    });
  });

  it("fails verification when an entry is modified in place", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({ path });
    await logger.log({ action: "tool_call", status: "error", toolName: "denied_tool" });
    await logger.log({ action: "tool_call", status: "ok", toolName: "allowed_tool" });

    const raw = await readFile(path, "utf8");
    const tampered = raw.replace('"status":"error"', '"status":"ok"');
    expect(tampered).not.toBe(raw);
    await writeFile(path, tampered);

    const verification = await verifyAuditLog({ path });
    expect(verification.ok).toBe(false);
    expect(verification.failures).toMatchObject([
      { lineNumber: 1, reason: expect.stringContaining("modified") }
    ]);
  });

  it("fails verification when an entry is removed from the middle", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({ path });
    await logger.log({ action: "profile_test", status: "ok", profileName: "one" });
    await logger.log({ action: "profile_test", status: "ok", profileName: "two" });
    await logger.log({ action: "profile_test", status: "ok", profileName: "three" });

    const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
    await writeFile(path, `${[lines[0], lines[2]].join("\n")}\n`);

    const verification = await verifyAuditLog({ path });
    expect(verification.ok).toBe(false);
    expect(verification.failures).toMatchObject([
      { lineNumber: 2, reason: expect.stringContaining("previous entry") }
    ]);
  });

  it("fails verification when chained entries are reordered", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({ path });
    await logger.log({ action: "profile_test", status: "ok", profileName: "one" });
    await logger.log({ action: "profile_test", status: "ok", profileName: "two" });

    const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
    await writeFile(path, `${[lines[1], lines[0]].join("\n")}\n`);

    const verification = await verifyAuditLog({ path });
    expect(verification.ok).toBe(false);
    expect(verification.failures.length).toBeGreaterThan(0);
  });

  it("fails verification on malformed lines and post-chain legacy entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({ path });
    await logger.log({ action: "profile_test", status: "ok", profileName: "one" });

    const raw = await readFile(path, "utf8");
    await writeFile(
      path,
      `${raw}{not-json\n${JSON.stringify({
        version: 1,
        timestamp: "2026-06-19T15:00:00.000Z",
        action: "profile_test",
        status: "ok",
        profileName: "late-legacy"
      })}\n`
    );

    const verification = await verifyAuditLog({ path });
    expect(verification.ok).toBe(false);
    expect(verification.failures).toMatchObject([
      { lineNumber: 2, reason: expect.stringContaining("not valid JSON") },
      { lineNumber: 3, reason: expect.stringContaining("unchained entry") }
    ]);
  });

  it("verification accepts truncation to a valid prefix (documented limit)", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({ path });
    await logger.log({ action: "profile_test", status: "ok", profileName: "one" });
    await logger.log({ action: "profile_test", status: "ok", profileName: "two" });

    const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
    await writeFile(path, `${lines[0]}\n`);

    const verification = await verifyAuditLog({ path });
    expect(verification.ok).toBe(true);
    expect(verification.chainedEntries).toBe(1);
  });

  it("verifies an empty or missing log as ok", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));

    await expect(
      verifyAuditLog({ path: join(root, "missing.jsonl") })
    ).resolves.toMatchObject({ ok: true, totalLines: 0 });
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

  it("filters by mandate id before applying the tail limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    const logger = createJsonlAuditLogger({ path });

    await logger.log({
      action: "tool_call",
      status: "ok",
      profileName: "one",
      mandateId: "fix-ci"
    });
    await logger.log({
      action: "tool_call",
      status: "ok",
      profileName: "two",
      mandateId: "other"
    });
    await logger.log({
      action: "tool_call",
      status: "ok",
      profileName: "three",
      mandateId: "fix-ci"
    });

    expect(
      await readAuditLogEntries({ path, mandateId: "fix-ci", limit: 1 })
    ).toMatchObject([{ profileName: "three", mandateId: "fix-ci" }]);
  });

  it("returns an empty list when the log file does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));

    await expect(
      readAuditLogEntries({ path: join(root, "missing.jsonl") })
    ).resolves.toEqual([]);
  });

  it("skips malformed JSONL lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-audit-"));
    const path = join(root, "switchboard.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({
          version: 1,
          timestamp: "2026-06-19T14:00:00.000Z",
          action: "profile_test",
          status: "ok",
          profileName: "good"
        }),
        "{not-json",
        JSON.stringify({
          version: 1,
          timestamp: "2026-06-19T14:01:00.000Z",
          action: "profile_test",
          status: "ok",
          profileName: "also-good"
        })
      ].join("\n")
    );

    expect(await readAuditLogEntries({ path })).toMatchObject([
      { profileName: "good" },
      { profileName: "also-good" }
    ]);
  });

  it("safe audit logging swallows logger failures", async () => {
    const errors: unknown[] = [];

    await expect(
      safeAuditLog(
        {
          async log() {
            throw new Error("disk is full");
          }
        },
        { action: "profile_test", status: "ok" },
        { onError: (error) => errors.push(error) }
      )
    ).resolves.toBeUndefined();

    expect(errors[0]).toBeInstanceOf(Error);
  });
});
