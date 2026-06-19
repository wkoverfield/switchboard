import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PathResolutionOptions } from "../config/paths.js";

export interface DaemonPaths {
  runtimeDir: string;
  socketPath: string;
  statePath: string;
}

export interface DaemonState {
  version: 1;
  pid: number;
  startedAt: string;
  socketPath: string;
}

export type DaemonStatus =
  | {
      state: "not-running";
      paths: DaemonPaths;
    }
  | {
      state: "running";
      paths: DaemonPaths;
      daemon: DaemonState;
    }
  | {
      state: "stale";
      paths: DaemonPaths;
      daemon: DaemonState;
    }
  | {
      state: "invalid";
      paths: DaemonPaths;
      error: string;
    };

export interface ResolveDaemonPathsOptions extends PathResolutionOptions {
  runtimeDir?: string;
}

export function resolveDaemonPaths(
  options: ResolveDaemonPathsOptions = {}
): DaemonPaths {
  const env = options.env ?? process.env;
  const runtimeRoot = options.runtimeDir
    ? resolve(options.runtimeDir)
    : env.SWITCHBOARD_RUNTIME_DIR
      ? resolve(env.SWITCHBOARD_RUNTIME_DIR)
      : env.XDG_RUNTIME_DIR
        ? join(resolve(env.XDG_RUNTIME_DIR), "switchboard")
        : join(tmpdir(), `switchboard-${currentUid()}`);

  return {
    runtimeDir: runtimeRoot,
    socketPath: join(runtimeRoot, "daemon.sock"),
    statePath: join(runtimeRoot, "daemon.json")
  };
}

export async function writeDaemonState(
  state: DaemonState,
  paths: DaemonPaths
): Promise<void> {
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  await writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600
  });
}

export async function removeDaemonState(paths: DaemonPaths): Promise<void> {
  await Promise.all([
    rm(paths.statePath, { force: true }),
    rm(paths.socketPath, { force: true })
  ]);
}

export function getDaemonStatus(paths: DaemonPaths): DaemonStatus {
  if (!existsSync(paths.statePath)) {
    return { state: "not-running", paths };
  }

  let daemon: DaemonState;
  try {
    daemon = parseDaemonState(readFileSync(paths.statePath, "utf8"));
  } catch (error) {
    return {
      state: "invalid",
      paths,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (!isProcessRunning(daemon.pid) || !existsSync(daemon.socketPath)) {
    return { state: "stale", paths, daemon };
  }

  return { state: "running", paths, daemon };
}

export async function readDaemonState(
  paths: DaemonPaths
): Promise<DaemonState | undefined> {
  const raw = await readFile(paths.statePath, "utf8").catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }

    throw error;
  });

  return raw === undefined ? undefined : parseDaemonState(raw);
}

export function createDaemonState(options: {
  pid: number;
  socketPath: string;
  startedAt?: Date;
}): DaemonState {
  return {
    version: 1,
    pid: options.pid,
    socketPath: options.socketPath,
    startedAt: (options.startedAt ?? new Date()).toISOString()
  };
}

function parseDaemonState(raw: string): DaemonState {
  const parsed = JSON.parse(raw) as Partial<DaemonState>;
  if (parsed.version !== 1) {
    throw new Error("Daemon state file is invalid.");
  }

  if (
    typeof parsed.pid !== "number" ||
    !Number.isSafeInteger(parsed.pid) ||
    parsed.pid <= 0
  ) {
    throw new Error("Daemon state file has an invalid pid.");
  }

  if (
    typeof parsed.startedAt !== "string" ||
    typeof parsed.socketPath !== "string"
  ) {
    throw new Error("Daemon state file is invalid.");
  }

  return parsed as DaemonState;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

function currentUid(): string {
  return typeof process.getuid === "function" ? String(process.getuid()) : "user";
}
