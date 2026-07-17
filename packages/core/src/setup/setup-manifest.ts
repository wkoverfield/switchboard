import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PathResolutionOptions } from "../config/paths.js";
import {
  rollbackSwitchboardClientConfig,
  type ClientConfigScope,
  type SupportedClient
} from "../install/client-config.js";

export const setupManifestSchemaVersion = "switchboard.setup-manifest.v1";

export type SetupWriteKind = "repo-config" | "client-config" | "global-config";

export interface SetupManifestEntry {
  kind: SetupWriteKind;
  path: string;
  action: "created" | "updated";
  backupPath: string | null;
  /** sha256 of the content setup wrote; recorded for created files so
   * rollback can tell an untouched file from one modified after setup. */
  contentHash?: string;
  client?: SupportedClient;
  scope?: ClientConfigScope;
  cwd?: string;
  recordedAt: string;
}

export interface SetupManifest {
  schemaVersion: typeof setupManifestSchemaVersion;
  entries: SetupManifestEntry[];
}

export interface SetupRollbackItem extends SetupManifestEntry {
  status: "restored" | "removed" | "already-removed" | "failed";
  /** Timestamped copy of the file content as it was just before rollback
   * touched it: always taken before restoring an update, and before removing
   * a created file whose content changed after setup. */
  snapshotPath: string | null;
  message: string | null;
}

export interface SetupRollbackResult {
  manifestPath: string;
  rolledBack: boolean;
  items: SetupRollbackItem[];
  failures: number;
}

/** The manifest file exists but cannot be parsed as a setup manifest. */
export class SetupManifestCorruptError extends Error {
  readonly path: string;

  constructor(path: string, cause: string) {
    super(`setup manifest at ${path} is unreadable: ${cause}`);
    this.name = "SetupManifestCorruptError";
    this.path = path;
  }
}

/** Another setup or rollback run holds the setup lock. */
export class SetupLockHeldError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      `another switchboard setup run holds the lock at ${path}; wait for it to finish, or delete the file if no setup is running`
    );
    this.name = "SetupLockHeldError";
    this.path = path;
  }
}

const setupLockStaleMs = 15 * 60_000;

export function resolveSetupManifestPath(
  options: PathResolutionOptions = {}
): string {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const stateRoot = env.XDG_STATE_HOME
    ? resolve(env.XDG_STATE_HOME)
    : join(home, ".local", "state");

  return join(stateRoot, "switchboard", "setup", "manifest.json");
}

export function resolveSetupLockPath(
  options: PathResolutionOptions = {}
): string {
  return join(dirname(resolveSetupManifestPath(options)), "setup.lock");
}

export async function readSetupManifest(
  options: PathResolutionOptions = {}
): Promise<SetupManifest | null> {
  const path = resolveSetupManifestPath(options);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }

  let parsed: SetupManifest;
  try {
    parsed = JSON.parse(raw) as SetupManifest;
  } catch (error) {
    throw new SetupManifestCorruptError(path, messageFromError(error));
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    parsed.schemaVersion !== setupManifestSchemaVersion ||
    !Array.isArray(parsed.entries)
  ) {
    throw new SetupManifestCorruptError(
      path,
      "not a valid switchboard setup manifest"
    );
  }

  return parsed;
}

/**
 * Move a corrupt manifest aside so its content stays recoverable and the
 * next setup run starts from a clean slate. Returns the quarantine path.
 */
export async function quarantineSetupManifest(
  options: PathResolutionOptions & { now?: Date } = {}
): Promise<string> {
  const path = resolveSetupManifestPath(options);
  const quarantinedPath = `${path}.corrupt-${backupTimestamp(options.now)}`;
  await rename(path, quarantinedPath);
  return quarantinedPath;
}

/**
 * Serialize setup and rollback runs with an O_EXCL lock file next to the
 * manifest. A lock older than 15 minutes is treated as left behind by a
 * crashed run and replaced.
 */
export async function acquireSetupRunLock(
  options: PathResolutionOptions = {}
): Promise<{ path: string; release: () => Promise<void> }> {
  const path = resolveSetupLockPath(options);
  await mkdir(dirname(path), { recursive: true });
  const content = `${JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString()
  })}\n`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, content, { encoding: "utf8", flag: "wx" });
      return {
        path,
        release: async () => {
          await rm(path, { force: true });
        }
      };
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) {
        throw error;
      }

      if (attempt === 0 && (await lockIsStale(path))) {
        await rm(path, { force: true });
        continue;
      }

      throw new SetupLockHeldError(path);
    }
  }

  throw new SetupLockHeldError(path);
}

async function lockIsStale(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return Date.now() - stats.mtimeMs > setupLockStaleMs;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      // The holder released between our EEXIST and this check.
      return true;
    }

    throw error;
  }
}

/**
 * Merge new setup writes into the manifest. The first record for a path
 * wins: repeated setup runs keep the original pre-setup backup, so one
 * rollback always lands on the state before the first setup run. Created
 * entries get a content hash of the file setup just wrote, and the manifest
 * is replaced atomically (temp file + rename).
 */
export async function recordSetupWrites(
  entries: Omit<SetupManifestEntry, "recordedAt">[],
  options: PathResolutionOptions & { now?: Date } = {}
): Promise<SetupManifest> {
  const path = resolveSetupManifestPath(options);
  const existing = (await readSetupManifest(options)) ?? {
    schemaVersion: setupManifestSchemaVersion,
    entries: []
  };
  const known = new Set(existing.entries.map((entry) => entry.path));
  const recordedAt = (options.now ?? new Date()).toISOString();
  const added: SetupManifestEntry[] = [];
  for (const entry of entries) {
    if (known.has(entry.path)) {
      continue;
    }

    let contentHash = entry.contentHash;
    if (entry.action === "created" && contentHash === undefined) {
      contentHash = (await hashFileContent(entry.path)) ?? undefined;
    }

    added.push({
      ...entry,
      ...(contentHash !== undefined ? { contentHash } : {}),
      recordedAt
    });
  }

  if (added.length === 0) {
    return existing;
  }

  const next: SetupManifest = {
    schemaVersion: setupManifestSchemaVersion,
    entries: [...existing.entries, ...added]
  };
  await writeManifestFile(path, next);
  return next;
}

/**
 * Reverse every write recorded by setup, newest first. Files setup updated
 * are restored from their pre-setup backup, always behind a snapshot of the
 * current content (client configs go through the shared rollback machinery,
 * which does the same). Files setup created are removed, but content that
 * changed after setup is snapshotted first so rollback never destroys work
 * it did not write. Successful items leave the manifest; failed items stay
 * so a repaired rollback can retry them.
 */
export async function rollbackSetupWrites(
  options: PathResolutionOptions = {}
): Promise<SetupRollbackResult> {
  const manifestPath = resolveSetupManifestPath(options);
  const manifest = await readSetupManifest(options);

  if (manifest === null || manifest.entries.length === 0) {
    return {
      manifestPath,
      rolledBack: false,
      items: [],
      failures: 0
    };
  }

  const items: SetupRollbackItem[] = [];
  for (const entry of [...manifest.entries].reverse()) {
    items.push(await rollbackSetupEntry(entry, options));
  }

  const failed = items.filter((item) => item.status === "failed");
  if (failed.length === 0) {
    await rm(manifestPath, { force: true });
  } else {
    const remaining: SetupManifest = {
      schemaVersion: setupManifestSchemaVersion,
      entries: manifest.entries.filter((entry) =>
        failed.some((item) => item.path === entry.path)
      )
    };
    await writeManifestFile(manifestPath, remaining);
  }

  return {
    manifestPath,
    rolledBack: true,
    items,
    failures: failed.length
  };
}

async function rollbackSetupEntry(
  entry: SetupManifestEntry,
  options: PathResolutionOptions
): Promise<SetupRollbackItem> {
  try {
    if (entry.action === "created") {
      return await rollbackCreatedEntry(entry);
    }

    if (entry.backupPath === null) {
      return {
        ...entry,
        status: "failed",
        snapshotPath: null,
        message: "no backup was recorded for this updated file"
      };
    }

    if (entry.kind === "client-config" && entry.client) {
      const restored = await rollbackSwitchboardClientConfig({
        client: entry.client,
        cwd: entry.cwd ?? process.cwd(),
        backupPath: entry.backupPath,
        ...(entry.scope ? { scope: entry.scope } : {}),
        ...(options.homeDir ? { homeDir: options.homeDir } : {}),
        ...(options.env ? { env: options.env } : {})
      });
      return {
        ...entry,
        status: "restored",
        snapshotPath: restored.backupPath,
        message: null
      };
    }

    const snapshotPath = await snapshotFileIfPresent(entry.path);
    await copyFile(entry.backupPath, entry.path);
    return { ...entry, status: "restored", snapshotPath, message: null };
  } catch (error) {
    return {
      ...entry,
      status: "failed",
      snapshotPath: null,
      message: messageFromError(error)
    };
  }
}

async function rollbackCreatedEntry(
  entry: SetupManifestEntry
): Promise<SetupRollbackItem> {
  const currentHash = await hashFileContent(entry.path);
  if (currentHash === null) {
    return {
      ...entry,
      status: "already-removed",
      snapshotPath: null,
      message: null
    };
  }

  // Remove without a trace only when the file is byte-for-byte what setup
  // wrote; anything else (edited after setup, or no recorded hash to compare
  // against) is snapshotted first.
  if (entry.contentHash !== undefined && currentHash === entry.contentHash) {
    await rm(entry.path);
    return { ...entry, status: "removed", snapshotPath: null, message: null };
  }

  const snapshotPath = await snapshotFileIfPresent(entry.path);
  await rm(entry.path);
  return {
    ...entry,
    status: "removed",
    snapshotPath,
    message:
      "content changed after setup; a snapshot was preserved before removal"
  };
}

async function snapshotFileIfPresent(path: string): Promise<string | null> {
  const baseSnapshotPath = `${path}.switchboard-backup-${backupTimestamp()}`;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshotPath =
      attempt === 0 ? baseSnapshotPath : `${baseSnapshotPath}-${attempt}`;
    try {
      await copyFile(path, snapshotPath, constants.COPYFILE_EXCL);
      return snapshotPath;
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        continue;
      }

      if (isErrorCode(error, "ENOENT")) {
        return null;
      }

      throw error;
    }
  }

  throw new Error(`could not create a unique snapshot path for ${path}`);
}

async function writeManifestFile(
  path: string,
  manifest: SetupManifest
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

async function hashFileContent(path: string): Promise<string | null> {
  try {
    const content = await readFile(path);
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

function backupTimestamp(now: Date = new Date()): string {
  return now.toISOString().replaceAll(/[-:.]/g, "").replace("T", "-");
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
