import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import {
  createDaemonState,
  getDaemonStatus,
  removeDaemonState,
  resolveDaemonPaths,
  writeDaemonState,
  type DaemonPaths,
  type DaemonStatus
} from "@switchboard-mcp/core";

export interface DaemonCommandOptions {
  runtimeDir?: string;
  cwd?: string;
}

export interface StartDaemonResult {
  ok: boolean;
  status: DaemonStatus;
  message: string;
}

export interface StopDaemonResult {
  ok: boolean;
  status: DaemonStatus;
  message: string;
}

export function daemonStatus(options: DaemonCommandOptions = {}): DaemonStatus {
  return getDaemonStatus(resolveDaemonPaths(options));
}

export async function startDaemon(
  options: DaemonCommandOptions = {}
): Promise<StartDaemonResult> {
  const paths = resolveDaemonPaths(options);
  const current = getDaemonStatus(paths);
  if (current.state === "running") {
    return { ok: true, status: current, message: "Switchboard daemon is already running." };
  }

  if (current.state === "stale" || current.state === "invalid") {
    await removeDaemonState(paths);
  }

  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return {
      ok: false,
      status: getDaemonStatus(paths),
      message: "Cannot determine CLI entrypoint for daemon start."
    };
  }

  const args = [
    ...(options.cwd ? ["--cwd", options.cwd] : []),
    "daemon",
    "run",
    "--runtime-dir",
    paths.runtimeDir
  ];
  const child = spawn(process.execPath, [entrypoint, ...args], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      SWITCHBOARD_RUNTIME_DIR: paths.runtimeDir
    }
  });
  child.unref();

  const status = await waitForStatus(paths, "running", 2500);
  return status.state === "running"
    ? { ok: true, status, message: "Switchboard daemon started." }
    : { ok: false, status, message: "Switchboard daemon did not start." };
}

export async function stopDaemon(
  options: DaemonCommandOptions = {}
): Promise<StopDaemonResult> {
  const paths = resolveDaemonPaths(options);
  const current = getDaemonStatus(paths);
  if (current.state === "not-running") {
    return { ok: true, status: current, message: "Switchboard daemon is not running." };
  }

  if (current.state === "stale" || current.state === "invalid") {
    await removeDaemonState(paths);
    return {
      ok: true,
      status: getDaemonStatus(paths),
      message: "Removed stale Switchboard daemon state."
    };
  }

  try {
    process.kill(current.daemon.pid, "SIGTERM");
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
  const stopped = await waitForStatus(paths, "not-running", 2500);
  if (stopped.state !== "not-running") {
    await removeDaemonState(paths);
  }

  return {
    ok: true,
    status: getDaemonStatus(paths),
    message: "Switchboard daemon stopped."
  };
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}

export async function runDaemon(
  options: DaemonCommandOptions = {}
): Promise<void> {
  const paths = resolveDaemonPaths(options);
  await rm(paths.socketPath, { force: true });

  const server = createServer((socket) => handleDaemonSocket(socket));
  await listen(server, paths.socketPath);
  await writeDaemonState(
    createDaemonState({ pid: process.pid, socketPath: paths.socketPath }),
    paths
  );

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await closeServer(server);
      await removeDaemonState(paths);
      resolve();
    };

    process.once("SIGTERM", () => {
      void shutdown();
    });
    process.once("SIGINT", () => {
      void shutdown();
    });
  });
}

async function waitForStatus(
  paths: DaemonPaths,
  state: DaemonStatus["state"],
  timeoutMs: number
): Promise<DaemonStatus> {
  const startedAt = Date.now();
  let status = getDaemonStatus(paths);
  while (Date.now() - startedAt < timeoutMs) {
    status = getDaemonStatus(paths);
    if (status.state === state) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return status;
}

function handleDaemonSocket(socket: Socket): void {
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    if (chunk.toString().trim() === "ping") {
      socket.write("pong\n");
    }
  });
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
