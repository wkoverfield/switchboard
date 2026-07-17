import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireSetupRunLock,
  quarantineSetupManifest,
  readSetupManifest,
  recordSetupWrites,
  resolveSetupManifestPath,
  rollbackSetupWrites,
  SetupLockHeldError,
  SetupManifestCorruptError
} from "./setup-manifest.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "switchboard-setup-manifest-"));
}

describe("setup manifest", () => {
  it("resolves under XDG_STATE_HOME", () => {
    const path = resolveSetupManifestPath({
      env: { XDG_STATE_HOME: "/state" } as NodeJS.ProcessEnv,
      homeDir: "/home/example"
    });
    expect(path).toBe("/state/switchboard/setup/manifest.json");
  });

  it("records writes and keeps the first entry per path across re-runs", async () => {
    const stateHome = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;

    await recordSetupWrites(
      [
        {
          kind: "global-config",
          path: "/tmp/example/config.yaml",
          action: "created",
          backupPath: null
        }
      ],
      { env }
    );
    await recordSetupWrites(
      [
        {
          kind: "global-config",
          path: "/tmp/example/config.yaml",
          action: "updated",
          backupPath: "/tmp/example/config.yaml.switchboard-backup-later"
        },
        {
          kind: "repo-config",
          path: "/tmp/example/.switchboard.yaml",
          action: "updated",
          backupPath: "/tmp/example/.switchboard.yaml.bak"
        }
      ],
      { env }
    );

    const manifest = await readSetupManifest({ env });
    expect(manifest?.entries).toHaveLength(2);
    // The original "created" record survives so rollback removes the file
    // instead of restoring a mid-setup state.
    expect(manifest?.entries[0]).toMatchObject({
      path: "/tmp/example/config.yaml",
      action: "created",
      backupPath: null
    });
  });

  it("does not create a manifest when there is nothing to record", async () => {
    const stateHome = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;

    await recordSetupWrites([], { env });

    expect(existsSync(resolveSetupManifestPath({ env }))).toBe(false);
  });

  it("rolls back created and updated files and clears the manifest", async () => {
    const stateHome = makeTempDir();
    const workDir = makeTempDir();
    const homeDir = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;

    const createdPath = join(workDir, "config.yaml");
    writeFileSync(createdPath, "created by setup\n");

    const updatedPath = join(workDir, ".switchboard.yaml");
    const backupPath = join(workDir, ".switchboard.yaml.backup");
    const originalContent = "version: 1\nprofiles: {}\n";
    writeFileSync(backupPath, originalContent);
    writeFileSync(updatedPath, "version: 1\nprofiles:\n  imported: {}\n");

    // Codex user config restored through the shared client rollback path.
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    const codexPath = join(homeDir, ".codex", "config.toml");
    const codexBackupPath = join(homeDir, ".codex", "config.toml.backup");
    const codexOriginal = 'model = "gpt-5"\n';
    writeFileSync(codexBackupPath, codexOriginal);
    writeFileSync(codexPath, 'model = "gpt-5"\n\n[mcp_servers."switchboard"]\n');

    await recordSetupWrites(
      [
        {
          kind: "repo-config",
          path: updatedPath,
          action: "updated",
          backupPath
        },
        {
          kind: "client-config",
          path: codexPath,
          action: "updated",
          backupPath: codexBackupPath,
          client: "codex",
          scope: "user",
          cwd: workDir
        },
        {
          kind: "global-config",
          path: createdPath,
          action: "created",
          backupPath: null
        }
      ],
      { env }
    );

    const result = await rollbackSetupWrites({ env, homeDir });

    expect(result.rolledBack).toBe(true);
    expect(result.failures).toBe(0);
    expect(result.items.map((item) => item.status)).toEqual([
      "removed",
      "restored",
      "restored"
    ]);
    expect(existsSync(createdPath)).toBe(false);
    expect(readFileSync(updatedPath, "utf8")).toBe(originalContent);
    expect(readFileSync(codexPath, "utf8")).toBe(codexOriginal);
    expect(existsSync(resolveSetupManifestPath({ env }))).toBe(false);
  });

  it("is idempotent: a second rollback reports nothing to roll back", async () => {
    const stateHome = makeTempDir();
    const workDir = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;
    const createdPath = join(workDir, "config.yaml");
    writeFileSync(createdPath, "created by setup\n");
    await recordSetupWrites(
      [
        {
          kind: "global-config",
          path: createdPath,
          action: "created",
          backupPath: null
        }
      ],
      { env }
    );

    const first = await rollbackSetupWrites({ env });
    expect(first.rolledBack).toBe(true);

    const second = await rollbackSetupWrites({ env });
    expect(second.rolledBack).toBe(false);
    expect(second.items).toEqual([]);
  });

  it("snapshots a created file that changed after setup before removing it", async () => {
    const stateHome = makeTempDir();
    const workDir = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;
    const createdPath = join(workDir, "config.toml");
    writeFileSync(createdPath, "written by setup\n");
    await recordSetupWrites(
      [
        {
          kind: "client-config",
          path: createdPath,
          action: "created",
          backupPath: null,
          client: "codex",
          scope: "user",
          cwd: workDir
        }
      ],
      { env }
    );

    // The user (or Codex) edits the file after setup created it.
    const editedContent = "written by setup\n\n[mcp_servers.added_by_user]\n";
    writeFileSync(createdPath, editedContent);

    const result = await rollbackSetupWrites({ env });

    expect(result.failures).toBe(0);
    const item = result.items[0];
    expect(item?.status).toBe("removed");
    expect(item?.snapshotPath).not.toBeNull();
    expect(item?.message).toContain("snapshot was preserved");
    expect(existsSync(createdPath)).toBe(false);
    expect(readFileSync(item?.snapshotPath ?? "", "utf8")).toBe(editedContent);
  });

  it("removes an unchanged created file without leaving a snapshot", async () => {
    const stateHome = makeTempDir();
    const workDir = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;
    const createdPath = join(workDir, "config.yaml");
    writeFileSync(createdPath, "written by setup\n");
    await recordSetupWrites(
      [
        {
          kind: "global-config",
          path: createdPath,
          action: "created",
          backupPath: null
        }
      ],
      { env }
    );

    const result = await rollbackSetupWrites({ env });

    expect(result.items[0]).toMatchObject({
      status: "removed",
      snapshotPath: null
    });
    expect(readdirSync(workDir)).toEqual([]);
  });

  it("snapshots the current content before restoring an updated file", async () => {
    const stateHome = makeTempDir();
    const workDir = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;
    const updatedPath = join(workDir, ".switchboard.yaml");
    const backupPath = join(workDir, ".switchboard.yaml.backup");
    const originalContent = "version: 1\n";
    const currentContent = "version: 1\nprofiles:\n  imported: {}\n";
    writeFileSync(backupPath, originalContent);
    writeFileSync(updatedPath, currentContent);
    await recordSetupWrites(
      [
        {
          kind: "repo-config",
          path: updatedPath,
          action: "updated",
          backupPath
        }
      ],
      { env }
    );

    const result = await rollbackSetupWrites({ env });

    const item = result.items[0];
    expect(item?.status).toBe("restored");
    expect(item?.snapshotPath).not.toBeNull();
    expect(readFileSync(item?.snapshotPath ?? "", "utf8")).toBe(currentContent);
    expect(readFileSync(updatedPath, "utf8")).toBe(originalContent);
  });

  it("reports a corrupt manifest as a typed error and quarantines it intact", async () => {
    const stateHome = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;
    const manifestPath = resolveSetupManifestPath({ env });
    mkdirSync(dirname(manifestPath), { recursive: true });
    const corruptContent = "{ not json";
    writeFileSync(manifestPath, corruptContent);

    await expect(readSetupManifest({ env })).rejects.toThrow(
      SetupManifestCorruptError
    );

    const quarantinedPath = await quarantineSetupManifest({ env });
    expect(quarantinedPath).toContain("manifest.json.corrupt-");
    expect(existsSync(manifestPath)).toBe(false);
    expect(readFileSync(quarantinedPath, "utf8")).toBe(corruptContent);
    expect(await readSetupManifest({ env })).toBeNull();
  });

  it("writes the manifest atomically without leaving temp files", async () => {
    const stateHome = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;
    await recordSetupWrites(
      [
        {
          kind: "global-config",
          path: "/tmp/example/config.yaml",
          action: "updated",
          backupPath: "/tmp/example/config.yaml.backup"
        }
      ],
      { env }
    );

    const manifestDir = dirname(resolveSetupManifestPath({ env }));
    expect(readdirSync(manifestDir)).toEqual(["manifest.json"]);
  });

  it("serializes runs with a lock and replaces a stale one", async () => {
    const stateHome = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;

    const lock = await acquireSetupRunLock({ env });
    await expect(acquireSetupRunLock({ env })).rejects.toThrow(
      SetupLockHeldError
    );
    await lock.release();

    // Released locks can be re-acquired.
    const second = await acquireSetupRunLock({ env });

    // A lock left behind by a crashed run (old mtime) is replaced.
    const staleTime = new Date(Date.now() - 60 * 60_000);
    utimesSync(second.path, staleTime, staleTime);
    const third = await acquireSetupRunLock({ env });
    await third.release();
  });

  it("keeps failed entries in the manifest for a retried rollback", async () => {
    const stateHome = makeTempDir();
    const workDir = makeTempDir();
    const env = { XDG_STATE_HOME: stateHome } as NodeJS.ProcessEnv;
    const updatedPath = join(workDir, "file.yaml");
    writeFileSync(updatedPath, "current\n");

    await recordSetupWrites(
      [
        {
          kind: "repo-config",
          path: updatedPath,
          action: "updated",
          backupPath: join(workDir, "missing-backup")
        }
      ],
      { env }
    );

    const result = await rollbackSetupWrites({ env });

    expect(result.failures).toBe(1);
    expect(result.items[0]?.status).toBe("failed");
    const manifest = await readSetupManifest({ env });
    expect(manifest?.entries).toHaveLength(1);
  });
});
