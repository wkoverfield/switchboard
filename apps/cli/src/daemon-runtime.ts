import { execFileSync, spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import {
  createJsonlAuditLogger,
  createDaemonState,
  getDaemonStatus,
  loadSwitchboardConfig,
  removeDaemonState,
  resolveActiveMandate,
  resolveDaemonPaths,
  writeDaemonState,
  type DaemonPaths,
  type DaemonStatus,
  type MandateWithStatus
} from "@switchboard-mcp/core";
import {
  GenericMcpRouter,
  pingDaemon,
  profileConfigToStdioUpstream,
  type NamespacedTool,
  type StdioUpstreamProfile
} from "@switchboard-mcp/mcp-runtime";

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

const daemonProtocolVersion = "0.1.0";

export async function daemonStatus(
  options: DaemonCommandOptions = {}
): Promise<DaemonStatus> {
  return verifiedDaemonStatus(resolveDaemonPaths(options));
}

export async function startDaemon(
  options: DaemonCommandOptions = {}
): Promise<StartDaemonResult> {
  const paths = resolveDaemonPaths(options);
  const current = await verifiedDaemonStatus(paths);
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
      status: await verifiedDaemonStatus(paths),
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
  const current = await verifiedDaemonStatus(paths);
  if (current.state === "not-running") {
    return { ok: true, status: current, message: "Switchboard daemon is not running." };
  }

  if (current.state === "stale" || current.state === "invalid") {
    await removeDaemonState(paths);
    return {
      ok: true,
      status: await verifiedDaemonStatus(paths),
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
    status: await verifiedDaemonStatus(paths),
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
  const daemonCwd = resolve(options.cwd ?? process.cwd());
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  await rm(paths.socketPath, { force: true });

  const socketContext = { cwd: daemonCwd };
  const server = createServer((socket) => handleDaemonSocket(socket, socketContext));
  await listen(server, paths.socketPath);
  await writeDaemonState(
    createDaemonState({
      pid: process.pid,
      socketPath: paths.socketPath,
      cwd: daemonCwd
    }),
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
  let status = await verifiedDaemonStatus(paths);
  while (Date.now() - startedAt < timeoutMs) {
    status = await verifiedDaemonStatus(paths);
    if (status.state === state) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return status;
}

async function verifiedDaemonStatus(paths: DaemonPaths): Promise<DaemonStatus> {
  const status = getDaemonStatus(paths);
  if (status.state !== "running") {
    return status;
  }

  return (await daemonHeartbeat(status.daemon.socketPath))
    ? status
    : { state: "stale", paths, daemon: status.daemon };
}

async function daemonHeartbeat(socketPath: string): Promise<boolean> {
  return pingDaemon(socketPath, { timeoutMs: 500 })
    .then(() => true)
    .catch(() => false);
}

export interface DaemonSocketContext {
  cwd?: string;
}

function handleDaemonSocket(socket: Socket, context: DaemonSocketContext): void {
  let buffered = "";
  let answered = false;

  socket.setEncoding("utf8");
  socket.on("error", () => {
    socket.destroy();
  });
  socket.on("data", (chunk) => {
    buffered += chunk.toString();

    while (buffered.includes("\n")) {
      const newlineIndex = buffered.indexOf("\n");
      const request = buffered.slice(0, newlineIndex).trim();
      buffered = buffered.slice(newlineIndex + 1);

      if (request.length === 0) {
        continue;
      }

      if (answered) {
        return;
      }
      answered = true;

      if (request === "ping") {
        socket.write(
          `${JSON.stringify({
            id: "legacy",
            ok: true,
            type: "pong",
            version: daemonProtocolVersion
          })}\n`
        );
        socket.end();
        return;
      }

      void handleDaemonRequest(request, context)
        .then((response) => {
          socket.write(`${JSON.stringify(response)}\n`);
          socket.end();
        })
        .catch((error: unknown) => {
          socket.write(
            `${JSON.stringify({
              id: "unknown",
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            })}\n`
          );
          socket.end();
        });
      return;
    }
  });
}

export async function handleDaemonRequest(raw: string, context: DaemonSocketContext): Promise<{
  id: string;
  ok: boolean;
  type?: "pong" | "tools" | "tool_result";
  version?: string;
  tools?: NamespacedTool[];
  result?: unknown;
  error?: string;
}> {
  try {
    const request = JSON.parse(raw) as {
      id?: unknown;
      type?: unknown;
      name?: unknown;
      arguments?: unknown;
      mandateId?: unknown;
    };
    const id = typeof request.id === "string" ? request.id : "unknown";
    if (request.type === "ping") {
      return {
        id,
        ok: true,
        type: "pong",
        version: daemonProtocolVersion
      };
    }
    if (request.type === "list_tools") {
      if (
        request.mandateId !== undefined &&
        !isValidMandateId(request.mandateId)
      ) {
        return {
          id,
          ok: false,
          error: "Daemon request mandateId must be a non-empty string."
        };
      }
      return listConfiguredTools(id, context, request.mandateId);
    }
    if (request.type === "call_tool") {
      if (typeof request.name !== "string" || request.name.length === 0) {
        return {
          id,
          ok: false,
          error: "Daemon call_tool request name is missing or invalid."
        };
      }
      if (
        request.arguments !== undefined &&
        !isRecord(request.arguments)
      ) {
        return {
          id,
          ok: false,
          error: "Daemon call_tool request arguments must be an object."
        };
      }

      if (
        request.mandateId !== undefined &&
        !isValidMandateId(request.mandateId)
      ) {
        return {
          id,
          ok: false,
          error: "Daemon request mandateId must be a non-empty string."
        };
      }

      return callConfiguredTool(
        id,
        context,
        request.name,
        request.arguments,
        request.mandateId
      );
    }

    return {
      id,
      ok: false,
      error: `Unsupported daemon request: ${String(request.type)}`
    };
  } catch {
    return {
      id: "unknown",
      ok: false,
      error: "Invalid daemon request."
    };
  }
}

async function listConfiguredTools(
  id: string,
  context: DaemonSocketContext,
  mandateId?: string
): Promise<{
  id: string;
  ok: boolean;
  type?: "tools";
  version?: string;
  tools?: NamespacedTool[];
  error?: string;
}> {
  const routerResult = await routerForConfiguredProfiles(context, mandateId);
  if (!routerResult.ok) {
    return {
      id,
      ok: false,
      error: routerResult.error
    };
  }

  const router = routerResult.router;
  try {
    return {
      id,
      ok: true,
      type: "tools",
      version: daemonProtocolVersion,
      tools: await router.discoverTools()
    };
  } catch (error) {
    return {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await router.close().catch(() => undefined);
  }
}

async function callConfiguredTool(
  id: string,
  context: DaemonSocketContext,
  name: string,
  args: Record<string, unknown> | undefined,
  mandateId?: string
): Promise<{
  id: string;
  ok: boolean;
  type?: "tool_result";
  version?: string;
  result?: unknown;
  error?: string;
}> {
  const routerResult = await routerForConfiguredProfiles(context, mandateId);
  if (!routerResult.ok) {
    return {
      id,
      ok: false,
      error: routerResult.error
    };
  }

  const router = routerResult.router;
  try {
    await router.discoverTools();
    return {
      id,
      ok: true,
      type: "tool_result",
      version: daemonProtocolVersion,
      result: await router.callTool(name, args)
    };
  } catch (error) {
    return {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await router.close().catch(() => undefined);
  }
}

async function routerForConfiguredProfiles(
  context: DaemonSocketContext,
  mandateId?: string
): Promise<
  | { ok: true; router: GenericMcpRouter }
  | { ok: false; error: string }
> {
  const loaded = loadSwitchboardConfig(optionsFromCwd(context.cwd));
  const validationError = loadedConfigError(loaded);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  let mandate: MandateWithStatus | undefined;
  if (mandateId) {
    try {
      const repoPath = configCwdBase(loaded, context.cwd);
      mandate = await resolveActiveMandate({
        id: mandateId,
        repoPath
      });
      const gitBinding = resolveGitWorktreeBinding(repoPath);
      if (gitBinding && gitBinding.branch !== mandate.branch) {
        return {
          ok: false,
          error: `mandate "${mandate.id}" is scoped to branch "${mandate.branch}", but current git branch is "${gitBinding.branch}" in ${gitBinding.worktreePath}`
        };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const profiles = stdioProfilesFromConfig(
    mandate
      ? Object.fromEntries(
          Object.entries(loaded.config.profiles).filter(([profileName]) =>
            mandate.profiles.includes(profileName)
          )
        )
      : loaded.config.profiles,
    configCwdBase(loaded, context.cwd)
  );
  if (profiles.length === 0) {
    return { ok: false, error: "No stdio upstream profiles are configured." };
  }

  return {
    ok: true,
    router: new GenericMcpRouter(profiles, {
      auditLogger: createJsonlAuditLogger(),
      ...(mandate
        ? {
            mandateId: mandate.id,
            toolPolicy: {
              allowedTools: mandate.allowedTools,
              deniedTools: mandate.deniedTools
            }
          }
        : {})
    })
  };
}

function loadedConfigError(
  loaded: ReturnType<typeof loadSwitchboardConfig>
): string | undefined {
  if (loaded.namespaceCollisions.length > 0) {
    return loaded.namespaceCollisions
      .map(
        (collision) =>
          `Namespace "${collision.namespace}" is used by profiles: ${collision.profiles.join(", ")}`
      )
      .join("; ");
  }

  const errors = loaded.diagnostics.filter(
    (diagnostic) => diagnostic.level === "error"
  );
  return errors.length > 0
    ? errors.map((diagnostic) => diagnostic.message).join("; ")
    : undefined;
}

function stdioProfilesFromConfig(
  profiles: ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"],
  cwdBase: string
): StdioUpstreamProfile[] {
  return Object.entries(profiles).flatMap(([profileName, profile]) => {
    const upstream = profileConfigToStdioUpstream(profileName, profile, {
      cwdBase
    });
    return upstream ? [upstream] : [];
  });
}

function optionsFromCwd(cwd: string | undefined): { cwd?: string } {
  return cwd ? { cwd } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidMandateId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function configCwdBase(
  loaded: ReturnType<typeof loadSwitchboardConfig>,
  cwd: string | undefined
): string {
  const repoSource = loaded.sources.find(
    (source) => source.kind === "repo" && source.loaded && source.path
  );

  if (repoSource?.path) {
    return dirname(repoSource.path);
  }

  return cwd ? resolve(cwd) : process.cwd();
}

function resolveGitWorktreeBinding(
  cwd: string
): { worktreePath: string; branch: string } | undefined {
  const worktreePath = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!worktreePath) {
    return undefined;
  }

  const branch = runGit(["branch", "--show-current"], cwd);
  if (!branch) {
    throw new Error(`git worktree at ${worktreePath} has no current branch`);
  }

  return { worktreePath, branch };
}

function runGit(args: string[], cwd: string): string | undefined {
  try {
    const output = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const trimmed = output.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
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
