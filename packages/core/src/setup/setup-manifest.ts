import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  message: string | null;
}

export interface SetupRollbackResult {
  manifestPath: string;
  rolledBack: boolean;
  items: SetupRollbackItem[];
  failures: number;
}

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

export async function readSetupManifest(
  options: PathResolutionOptions = {}
): Promise<SetupManifest | null> {
  const path = resolveSetupManifestPath(options);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  const parsed = JSON.parse(raw) as SetupManifest;
  if (
    parsed.schemaVersion !== setupManifestSchemaVersion ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(`${path} is not a valid switchboard setup manifest`);
  }

  return parsed;
}

/**
 * Merge new setup writes into the manifest. The first record for a path
 * wins: repeated setup runs keep the original pre-setup backup, so one
 * rollback always lands on the state before the first setup run.
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
  const added = entries
    .filter((entry) => !known.has(entry.path))
    .map((entry) => ({ ...entry, recordedAt }));

  if (added.length === 0) {
    return existing;
  }

  const next: SetupManifest = {
    schemaVersion: setupManifestSchemaVersion,
    entries: [...existing.entries, ...added]
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/**
 * Reverse every write recorded by setup, newest first. Files setup created
 * are removed; files setup updated are restored from their pre-setup backup
 * (client configs through the shared rollback machinery, which snapshots the
 * current file before restoring). Successful items leave the manifest;
 * failed items stay so a repaired rollback can retry them.
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
    await writeFile(
      manifestPath,
      `${JSON.stringify(remaining, null, 2)}\n`,
      "utf8"
    );
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
      const removed = await removeFileIfPresent(entry.path);
      return {
        ...entry,
        status: removed ? "removed" : "already-removed",
        message: null
      };
    }

    if (entry.backupPath === null) {
      return {
        ...entry,
        status: "failed",
        message: "no backup was recorded for this updated file"
      };
    }

    if (entry.kind === "client-config" && entry.client) {
      await rollbackSwitchboardClientConfig({
        client: entry.client,
        cwd: entry.cwd ?? process.cwd(),
        backupPath: entry.backupPath,
        ...(entry.scope ? { scope: entry.scope } : {}),
        ...(options.homeDir ? { homeDir: options.homeDir } : {}),
        ...(options.env ? { env: options.env } : {})
      });
      return { ...entry, status: "restored", message: null };
    }

    await copyFile(entry.backupPath, entry.path);
    return { ...entry, status: "restored", message: null };
  } catch (error) {
    return {
      ...entry,
      status: "failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function removeFileIfPresent(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
