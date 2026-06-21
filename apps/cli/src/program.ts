import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  type AuditLogEntry,
  type AuditLogger,
  type ApprovalRequestWithStatus,
  checkLocalConfigIgnored,
  createChildMandate,
  createMandate,
  decideApprovalRequest,
  createInitConfigPlan,
  inspectProjectClientConfigs,
  listApprovalRequests,
  listMandates,
  type LoadConfigOptions,
  loadSwitchboardConfig,
  type MandateToolPolicy,
  type MandateWithStatus,
  noopAuditLogger,
  namespacesForProfiles,
  normalizeMandateId,
  readAuditLogEntries,
  renderSwitchboardClientConfig,
  resolveApprovalRequestStorePath,
  resolveAuditLogPath,
  resolveActiveMandate,
  resolveMandateStorePath,
  rollbackSwitchboardClientConfig,
  safeAuditLog,
  type PathResolutionOptions,
  resolveGlobalConfigPath,
  resolveRepoConfigPaths,
  starterUpstreamArgPlaceholder,
  type SupportedClient,
  updateMandateHandoff,
  validateInitConfigOptions,
  validateSwitchboardClientConfigOptions,
  type ProjectClientConfigInspection,
  writeSwitchboardClientConfig,
  type RolledBackClientConfig,
  type WrittenClientConfig
} from "@switchboard-mcp/core";
import {
  GenericMcpRouter,
  listDaemonTools,
  pingDaemon,
  profileConfigToStdioUpstream,
  serveDaemonBackedMcpStdio,
  serveSwitchboardMcpStdio,
  testStdioUpstreamProfile,
  type NamespacedTool,
  type StdioProfileTestOptions,
  type StdioProfileTestResult,
  type StdioUpstreamProfile
} from "@switchboard-mcp/mcp-runtime";
import {
  daemonStatus,
  runDaemon,
  startDaemon,
  stopDaemon,
  type StartDaemonResult,
  type StopDaemonResult
} from "./daemon-runtime.js";

const version = "0.1.0";
const mandateMcpLaunchSchemaVersion = "switchboard.mcp-launch.v1";
const mandateStatusSchemaVersion = "switchboard.mandate-status.v1";
const mandateReportSchemaVersion = "switchboard.mandate-report.v1";
const approvalRequestsSchemaVersion = "switchboard.approvals.v1";
const toolSurfaceSchemaVersion = "switchboard.tool-surface.v1";

interface MandateMcpLaunchPayload {
  schemaVersion: typeof mandateMcpLaunchSchemaVersion;
  transport: "stdio";
  mandateId: string;
  cwd: string;
  command: "switchboard";
  args: string[];
}

interface MandateReportPayload {
  schemaVersion: typeof mandateReportSchemaVersion;
  path: string;
  auditLogPath: string;
  repoPath: string | null;
  selectedMandateId: string;
  selectedMandateUid: string | null;
  rootMandateId: string;
  rootMandateUid: string | null;
  generatedAt: string;
  counts: {
    mandates: number;
    open: number;
    completed: number;
    blocked: number;
    cancelled: number;
    active: number;
    expired: number;
    closed: number;
    auditEntries: number;
    approvalRequests: number;
  };
  childrenByParent: Record<string, string[]>;
  mandates: MandateWithStatus[];
  approvalRequests: ApprovalRequestWithStatus[];
  auditEntries: AuditLogEntry[];
}

interface ApprovalRequestsPayload {
  schemaVersion: typeof approvalRequestsSchemaVersion;
  path: string;
  mandateStorePath: string | null;
  repoPath: string | null;
  mandateId: string | null;
  includeChildren: boolean;
  rootMandateId: string | null;
  rootMandateUid: string | null;
  childrenByParent: Record<string, string[]>;
  counts: {
    requests: number;
    pending: number;
    approved: number;
    denied: number;
    stale: number;
    expired: number;
  };
  mandates: MandateWithStatus[];
  requests: ApprovalRequestWithStatus[];
}

export interface ProgramIo {
  writeOut?: (message: string) => void;
  writeErr?: (message: string) => void;
  auditLogger?: AuditLogger;
  auditLogPath?: string;
  approvalStorePath?: string;
  mandateStorePath?: string;
  serveMcp?: (
    profiles: StdioUpstreamProfile[],
    options?: {
      auditLogger?: AuditLogger;
      mandateId?: string;
      auditContext?: {
        mandateUid?: string;
        repoPath?: string;
        worktreePath?: string;
        branch?: string;
      };
      toolPolicy?: MandateToolPolicy;
    }
  ) => Promise<void>;
  listTools?: (
    profiles: StdioUpstreamProfile[],
    options?: {
      auditLogger?: AuditLogger;
      mandateId?: string;
      auditContext?: {
        mandateUid?: string;
        repoPath?: string;
        worktreePath?: string;
        branch?: string;
      };
      toolPolicy?: MandateToolPolicy;
    }
  ) => Promise<NamespacedTool[]>;
  testProfile?: (
    profile: StdioUpstreamProfile,
    options?: StdioProfileTestOptions
  ) => Promise<StdioProfileTestResult>;
  daemonStatus?: typeof daemonStatus;
  startDaemon?: typeof startDaemon;
  serveDaemonMcp?: (
    socketPath: string,
    options?: { mandateId?: string; approvalWaitMs?: number }
  ) => Promise<void>;
}

export function createProgram(io: ProgramIo = {}): Command {
  const writeOut = io.writeOut ?? ((message: string) => console.log(message));
  const writeErr = io.writeErr ?? ((message: string) => console.error(message));
  const serveMcp = io.serveMcp ?? serveProfilesOverStdio;
  const listToolsForProfiles = io.listTools ?? listToolsOverProfiles;
  const testProfile = io.testProfile ?? testStdioUpstreamProfile;
  const getDaemonStatus = io.daemonStatus ?? daemonStatus;
  const startDaemonProcess = io.startDaemon ?? startDaemon;
  const serveDaemonMcp = io.serveDaemonMcp ?? serveDaemonBackedMcpStdio;
  const auditLogger = io.auditLogger ?? noopAuditLogger;
  const program = new Command();
  const decideApprovalRequestForCommand = async (
    id: string,
    status: "approved" | "denied",
    options: { reason?: string; json?: boolean }
  ): Promise<void> => {
    const path = io.approvalStorePath ?? resolveApprovalRequestStorePath();
    try {
      const request = await decideApprovalRequest({
        path,
        id,
        status,
        ...(options.reason ? { reason: options.reason } : {})
      });
      if (options.json) {
        writeOut(JSON.stringify({ path, request }, null, 2));
      } else {
        writeOut(formatApprovalDecision(path, request));
      }
    } catch (error) {
      writeErr(`error: ${messageFromError(error)}`);
      process.exitCode = 1;
    }
  };

  program
    .name("switchboard")
    .description(
      "Local mandate layer and MCP profile router for coding agents."
    )
    .version(version)
    .option("--cwd <path>", "resolve repo config from this directory");

  program
    .command("status")
    .description("Show active Switchboard config sources and profiles.")
    .option("--json", "print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const configOptions = optionsFromCwd(globalOptions.cwd);
      const loaded = loadSwitchboardConfig(configOptions);
      const repoPaths = resolveRepoConfigPaths(configOptions);
      const status = {
        globalConfigPath: resolveGlobalConfigPath(),
        repoConfigPath: repoPaths.repoConfigPath ?? null,
        repoLocalConfigPath: repoPaths.repoLocalConfigPath ?? null,
        sources: loaded.sources,
        profileCount: Object.keys(loaded.config.profiles).length,
        workspaceCount: Object.keys(loaded.config.workspaces).length,
        namespaces: namespacesForProfiles(loaded.config.profiles),
        diagnostics: loaded.diagnostics
      };

      if (options.json) {
        writeOut(JSON.stringify(status, null, 2));
        return;
      }

      writeOut(formatStatus(status));
    });

  program
    .command("doctor")
    .description("Run basic Switchboard config checks.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const configOptions = optionsFromCwd(globalOptions.cwd);
      const loaded = loadSwitchboardConfig(configOptions);
      const localIgnore = checkLocalConfigIgnored(globalOptions.cwd);
      const cwd = configCwdBase(loaded, globalOptions.cwd);
      const clientConfigs = await inspectProjectClientConfigs({ cwd });
      const checks = [
        {
          name: "config-schema",
          ok: !loaded.diagnostics.some((item) => item.level === "error"),
          message: "Config files parse and match the Switchboard schema."
        },
        {
          name: "namespace-collisions",
          ok: loaded.namespaceCollisions.length === 0,
          message: "Profile namespaces are unique after normalization."
        },
        {
          name: "local-config-gitignore",
          ok: localIgnore.ok,
          message: localIgnore.message
        },
        {
          name: "client-configs",
          ok: clientConfigs.every((item) => item.status !== "invalid"),
          message: clientConfigSummary(clientConfigs)
        }
      ];

      const ok = checks.every((check) => check.ok);
      const result = {
        ok,
        checks,
        diagnostics: loaded.diagnostics,
        namespaceCollisions: loaded.namespaceCollisions,
        clientConfigs,
        nextSteps: doctorNextSteps({
          ok,
          loaded,
          localIgnoreOk: localIgnore.ok,
          clientConfigs,
          cwd: globalOptions.cwd
        })
      };

      if (options.json) {
        writeOut(JSON.stringify(result, null, 2));
      } else {
        writeOut(formatDoctor(result));
      }

      if (!ok) {
        process.exitCode = 1;
      }
    });

  program
    .command("tools")
    .description("List the configured Switchboard tool surface.")
    .option("--json", "print machine-readable JSON")
    .option("--mandate <id>", "show tools through an active mandate")
    .action(async (options: { json?: boolean; mandate?: string }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));

      if (!validateLoadedConfigForCommand(loaded, writeErr)) {
        return;
      }
      const mandate = options.mandate
        ? await resolveActiveMandateForCommand({
            id: options.mandate,
            cwd: globalOptions.cwd,
            mandateStorePath: io.mandateStorePath,
            writeErr
          })
        : undefined;
      if (options.mandate && !mandate) {
        process.exitCode = 1;
        return;
      }

      const profiles = stdioProfilesFromConfig(
        mandate
          ? profilesForMandate(loaded.config.profiles, mandate)
          : loaded.config.profiles,
        configCwdBase(loaded, globalOptions.cwd)
      );
      if (profiles.length === 0) {
        writeErr("error: no stdio upstream profiles are configured");
        process.exitCode = 1;
        return;
      }

      try {
        const tools = await listToolsForProfiles(profiles, {
          auditLogger,
          ...(mandate
            ? {
                mandateId: mandate.id,
                auditContext: mandateAuditContext(mandate),
                toolPolicy: {
                  allowedTools: mandate.allowedTools,
                  deniedTools: mandate.deniedTools,
                  approvalGates: mandate.approvalGates,
                  approvedApprovalRequests:
                    await approvedApprovalRequestsForMandate(
                      mandate,
                      io.approvalStorePath
                    )
                }
              }
            : {})
        });
        const result = {
          schemaVersion: toolSurfaceSchemaVersion,
          ok: true,
          mandate: mandate
            ? { id: mandate.id, runtimeStatus: mandate.runtimeStatus }
            : null,
          profileCount: profiles.length,
          toolCount: tools.length,
          approvalRequiredCount: tools.filter(hasApprovalRequiredMetadata)
            .length,
          tools
        };

        if (options.json) {
          writeOut(JSON.stringify(result, null, 2));
        } else {
          writeOut(formatToolSurface(result));
        }
      } catch (error) {
        writeErr(`error: ${messageFromError(error)}`);
        process.exitCode = 1;
      }
    });

  program
    .command("init")
    .description("Create or print a starter Switchboard repo config.")
    .option("--json", "print machine-readable JSON")
    .option("--write", "write .switchboard.yaml")
    .option("--force", "overwrite .switchboard.yaml when used with --write")
    .option("--profile-name <name>", "starter profile name", "local_example")
    .option("--command <command>", "starter upstream command", "node")
    .action(
      (options: {
        json?: boolean;
        write?: boolean;
        force?: boolean;
        profileName: string;
        command: string;
      }) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const validation = validateInitConfigOptions({
          profileName: options.profileName,
          command: options.command
        });
        if (!validation.ok) {
          for (const error of validation.errors) {
            writeErr(`error: ${error}`);
          }
          process.exitCode = 1;
          return;
        }

        const plan = createInitConfigPlan({
          ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
          profileName: options.profileName,
          command: options.command
        });

        if (options.write) {
          if (plan.exists && !options.force) {
            writeErr(
              `error: ${plan.path} already exists; use --force to overwrite`
            );
            process.exitCode = 1;
            return;
          }

          writeFileSync(plan.path, plan.content);
        }

        const result = {
          path: plan.path,
          written: Boolean(options.write),
          overwritten: Boolean(options.write && plan.exists),
          content: plan.content
        };

        if (options.json) {
          writeOut(JSON.stringify(result, null, 2));
          return;
        }

        writeOut(formatInit(result));
      }
    );

  const daemon = program
    .command("daemon")
    .description("Manage the local Switchboard daemon.");

  daemon
    .command("status")
    .description("Show local daemon status.")
    .option("--json", "print machine-readable JSON")
    .option("--runtime-dir <path>", "override daemon runtime directory")
    .action(async (options: { json?: boolean; runtimeDir?: string }) => {
      const status = await getDaemonStatus(optionsFromRuntimeDir(options.runtimeDir));
      if (options.json) {
        writeOut(JSON.stringify(status, null, 2));
        return;
      }

      writeOut(formatDaemonStatus(status));
    });

  daemon
    .command("start")
    .description("Start the local Switchboard daemon.")
    .option("--json", "print machine-readable JSON")
    .option("--runtime-dir <path>", "override daemon runtime directory")
    .action(async (options: { json?: boolean; runtimeDir?: string }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const result = await startDaemonProcess({
        ...optionsFromRuntimeDir(options.runtimeDir),
        ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {})
      });
      if (options.json) {
        writeOut(JSON.stringify(result, null, 2));
      } else {
        writeOut(formatDaemonStart(result));
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  daemon
    .command("stop")
    .description("Stop the local Switchboard daemon.")
    .option("--json", "print machine-readable JSON")
    .option("--runtime-dir <path>", "override daemon runtime directory")
    .action(async (options: { json?: boolean; runtimeDir?: string }) => {
      const result = await stopDaemon(optionsFromRuntimeDir(options.runtimeDir));
      if (options.json) {
        writeOut(JSON.stringify(result, null, 2));
      } else {
        writeOut(formatDaemonStop(result));
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  daemon
    .command("ping")
    .description("Ping the local Switchboard daemon socket.")
    .option("--json", "print machine-readable JSON")
    .option("--runtime-dir <path>", "override daemon runtime directory")
    .action(async (options: { json?: boolean; runtimeDir?: string }) => {
      const status = await getDaemonStatus(optionsFromRuntimeDir(options.runtimeDir));
      if (status.state !== "running") {
        const result = {
          ok: false,
          status,
          error: "Switchboard daemon is not running."
        };
        if (options.json) {
          writeOut(JSON.stringify(result, null, 2));
        } else {
          writeErr(result.error);
        }
        process.exitCode = 1;
        return;
      }

      try {
        const response = await pingDaemon(status.daemon.socketPath);
        const result = { ok: true, status, response };
        if (options.json) {
          writeOut(JSON.stringify(result, null, 2));
        } else {
          writeOut(`Switchboard daemon ping: ${response.type}`);
        }
      } catch (error) {
        const result = {
          ok: false,
          status,
          error: error instanceof Error ? error.message : String(error)
        };
        if (options.json) {
          writeOut(JSON.stringify(result, null, 2));
        } else {
          writeErr(`error: ${result.error}`);
        }
        process.exitCode = 1;
      }
    });

  daemon
    .command("tools")
    .description("List tools discovered by the local Switchboard daemon.")
    .option("--json", "print machine-readable JSON")
    .option("--runtime-dir <path>", "override daemon runtime directory")
    .action(async (options: { json?: boolean; runtimeDir?: string }) => {
      const status = await getDaemonStatus(optionsFromRuntimeDir(options.runtimeDir));
      if (status.state !== "running") {
        const result = {
          ok: false,
          status,
          error: "Switchboard daemon is not running."
        };
        if (options.json) {
          writeOut(JSON.stringify(result, null, 2));
        } else {
          writeErr(result.error);
        }
        process.exitCode = 1;
        return;
      }

      try {
        const response = await listDaemonTools(status.daemon.socketPath);
        const result = { ok: true, status, response };
        if (options.json) {
          writeOut(JSON.stringify(result, null, 2));
        } else {
          writeOut(formatDaemonTools(response.tools));
        }
      } catch (error) {
        const result = {
          ok: false,
          status,
          error: error instanceof Error ? error.message : String(error)
        };
        if (options.json) {
          writeOut(JSON.stringify(result, null, 2));
        } else {
          writeErr(`error: ${result.error}`);
        }
        process.exitCode = 1;
      }
    });

  daemon
    .command("run", { hidden: true })
    .option("--runtime-dir <path>", "override daemon runtime directory")
    .action(async (options: { runtimeDir?: string }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      await runDaemon({
        ...optionsFromRuntimeDir(options.runtimeDir),
        ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {})
      });
    });

  program
    .command("mcp")
    .description("Serve MCP over stdio through the local Switchboard daemon.")
    .option("--runtime-dir <path>", "override daemon runtime directory")
    .option("--mandate <id>", "bind routed tool calls to an active mandate")
    .option(
      "--approval-wait <duration>",
      "wait for approval decisions during gated tool calls, like 30s, 2m, or 0"
    )
    .option("--no-auto-start", "fail if the daemon is not already running")
    .action(
      async (options: {
        runtimeDir?: string;
        mandate?: string;
        approvalWait?: string;
        autoStart?: boolean;
      }) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const daemonOptions = {
          ...optionsFromRuntimeDir(options.runtimeDir),
          ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {})
        };
        const desiredCwd = resolve(globalOptions.cwd ?? process.cwd());
        let status = await getDaemonStatus(daemonOptions);
        if (status.state === "running" && status.daemon.cwd !== desiredCwd) {
          writeErr(
            `error: Switchboard daemon is running for ${status.daemon.cwd ?? "an unknown cwd"}; stop it or use --runtime-dir for a separate daemon before serving ${desiredCwd}`
          );
          process.exitCode = 1;
          return;
        }

        if (status.state !== "running") {
          if (options.autoStart === false) {
            writeErr(
              "error: Switchboard daemon is not running; run switchboard daemon start first"
            );
            process.exitCode = 1;
            return;
          }

          const started = await startDaemonProcess(daemonOptions);
          if (!started.ok || started.status.state !== "running") {
            writeErr(`error: ${started.message}`);
            process.exitCode = 1;
            return;
          }
          status = started.status;
          if (status.daemon.cwd !== desiredCwd) {
            writeErr(
              `error: Switchboard daemon is running for ${status.daemon.cwd ?? "an unknown cwd"}; stop it or use --runtime-dir for a separate daemon before serving ${desiredCwd}`
            );
            process.exitCode = 1;
            return;
          }
        }

        const mandate = options.mandate
          ? await resolveActiveMandateForCommand({
              id: options.mandate,
              cwd: globalOptions.cwd,
              mandateStorePath: io.mandateStorePath,
              writeErr
            })
          : undefined;
        if (options.mandate && !mandate) {
          process.exitCode = 1;
          return;
        }
        const approvalWaitMs = parseApprovalWaitDurationForCommand(
          options.approvalWait,
          writeErr
        );
        if (approvalWaitMs === undefined) {
          process.exitCode = 1;
          return;
        }

        await serveDaemonMcp(
          status.daemon.socketPath,
          {
            ...(mandate ? { mandateId: mandate.id } : {}),
            ...(approvalWaitMs > 0 ? { approvalWaitMs } : {})
          }
        );
      }
    );

  program
    .command("serve")
    .description("Serve configured stdio MCP upstreams through one Switchboard MCP endpoint.")
    .option("--mandate <id>", "bind routed tool calls to an active mandate")
    .action(async (options: { mandate?: string }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));

      if (!validateLoadedConfigForCommand(loaded, writeErr)) {
        return;
      }
      const mandate = options.mandate
        ? await resolveActiveMandateForCommand({
            id: options.mandate,
            cwd: globalOptions.cwd,
            mandateStorePath: io.mandateStorePath,
            writeErr
          })
        : undefined;
      if (options.mandate && !mandate) {
        process.exitCode = 1;
        return;
      }

      const profiles = stdioProfilesFromConfig(
        mandate
          ? profilesForMandate(loaded.config.profiles, mandate)
          : loaded.config.profiles,
        configCwdBase(loaded, globalOptions.cwd)
      );
      if (profiles.length === 0) {
        writeErr("error: no stdio upstream profiles are configured");
        process.exitCode = 1;
        return;
      }

      await serveMcp(profiles, {
        auditLogger,
        ...(mandate
          ? {
              mandateId: mandate.id,
              auditContext: mandateAuditContext(mandate),
              toolPolicy: {
                allowedTools: mandate.allowedTools,
                deniedTools: mandate.deniedTools,
                approvalGates: mandate.approvalGates,
                approvedApprovalRequests:
                  await approvedApprovalRequestsForMandate(
                    mandate,
                    io.approvalStorePath
                  )
              }
            }
          : {})
      });
    });

  program
    .command("test <profile>")
    .description("Test one configured stdio MCP profile by listing its tools.")
    .option("--json", "print machine-readable JSON")
    .option("--timeout-ms <ms>", "MCP request timeout in milliseconds", "5000")
    .action(
      async (
        profileName: string,
        options: { json?: boolean; timeoutMs: string }
      ) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
        const timeoutMs = parseTimeoutMs(options.timeoutMs);

        if (timeoutMs === undefined) {
          writeErr("error: --timeout-ms must be a positive integer");
          process.exitCode = 1;
          return;
        }

        if (!validateLoadedConfigForCommand(loaded, writeErr)) {
          return;
        }

        const profile = loaded.config.profiles[profileName];
        if (!profile) {
          writeErr(`error: profile "${profileName}" was not found`);
          process.exitCode = 1;
          return;
        }

        const upstream = profileConfigToStdioUpstream(profileName, profile, {
          cwdBase: configCwdBase(loaded, globalOptions.cwd)
        });
        if (!upstream) {
          writeErr(
            `error: profile "${profileName}" does not define a stdio upstream`
          );
          process.exitCode = 1;
          return;
        }

        try {
          const startedAt = Date.now();
          const result = await testProfile(upstream, { timeoutMs });
          const auditEntry = {
            action: "profile_test",
            status: result.ok ? "ok" : "error",
            profileName,
            namespace: upstream.namespace,
            durationMs: Date.now() - startedAt
          } as const;
          await safeAuditLog(
            auditLogger,
            result.ok
              ? auditEntry
              : { ...auditEntry, error: "profile test failed" }
          );
          if (options.json) {
            writeOut(JSON.stringify(result, null, 2));
          } else {
            writeOut(formatProfileTest(result));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await safeAuditLog(auditLogger, {
            action: "profile_test",
            status: "error",
            profileName,
            namespace: upstream.namespace,
            error: message
          });
          if (options.json) {
            writeOut(
              JSON.stringify(
                {
                  ok: false,
                  profileName,
                  error: message
                },
                null,
                2
              )
            );
          } else {
            writeErr(`error: ${message}`);
          }
          process.exitCode = 1;
        }
      }
    );

  program
    .command("mandate")
    .description("Create and inspect task-scoped coding-agent mandates.")
    .addCommand(
      new Command("create")
        .description("Create a local task-scoped mandate.")
        .argument("<task>", "task name or summary")
        .requiredOption("--agent <role>", "agent role for this mandate")
        .requiredOption(
          "--profiles <profiles>",
          "comma-separated Switchboard profiles to bind"
        )
        .requiredOption("--branch <branch>", "branch the mandate is scoped to")
        .requiredOption("--lease <duration>", "lease duration, like 30m, 2h, or 1d")
        .option(
          "--allow-tool <pattern>",
          "allow a namespaced tool pattern (repeatable)",
          collectOption,
          [] as string[]
        )
        .option(
          "--deny-tool <pattern>",
          "deny a namespaced tool pattern (repeatable)",
          collectOption,
          [] as string[]
        )
        .option(
          "--require-approval-tool <pattern>",
          "require approval for a namespaced tool pattern (repeatable)",
          collectOption,
          [] as string[]
        )
        .option(
          "--require-approval-reason <reason>",
          "human reason for a required approval gate (repeatable, matches --require-approval-tool order)",
          collectOption,
          [] as string[]
        )
        .option(
          "--require-approval-risk <risk>",
          "risk class for a required approval gate: low, medium, high, or critical (repeatable, matches --require-approval-tool order)",
          collectOption,
          [] as string[]
        )
        .option(
          "--require-approval-label <label>",
          "structured label for approval gates (repeatable, applies to every approval gate)",
          collectOption,
          [] as string[]
        )
        .option("--json", "print machine-readable JSON")
        .action(
          async (
            task: string,
            options: {
              agent: string;
              profiles: string;
              branch: string;
              lease: string;
              allowTool: string[];
              denyTool: string[];
              requireApprovalTool: string[];
              requireApprovalReason: string[];
              requireApprovalRisk: string[];
              requireApprovalLabel: string[];
              json?: boolean;
            }
          ) => {
            const globalOptions = program.opts<{ cwd?: string }>();
            const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
            if (!validateLoadedConfigForCommand(loaded, writeErr)) {
              return;
            }

            const profiles = parseCommaSeparatedList(options.profiles);
            const missingProfiles = profiles.filter(
              (profile) => !loaded.config.profiles[profile]
            );
            if (missingProfiles.length > 0) {
              writeErr(
                `error: mandate profiles were not found: ${missingProfiles.join(", ")}`
              );
              process.exitCode = 1;
              return;
            }

            const repoPath = configCwdBase(loaded, globalOptions.cwd);
            let gitBinding: { worktreePath: string; branch: string } | undefined;
            try {
              gitBinding = resolveGitWorktreeBinding(repoPath);
            } catch (error) {
              writeErr(`error: ${messageFromError(error)}`);
              process.exitCode = 1;
              return;
            }
            const branch = options.branch.trim();
            if (gitBinding && gitBinding.branch !== branch) {
              writeErr(
                `error: mandate branch "${branch}" does not match current git branch "${gitBinding.branch}" in ${gitBinding.worktreePath}`
              );
              process.exitCode = 1;
              return;
            }
            if (
              options.requireApprovalReason.length > 0 &&
              options.requireApprovalReason.length !==
                options.requireApprovalTool.length
            ) {
              writeErr(
                "error: --require-approval-reason must be provided once for each --require-approval-tool"
              );
              process.exitCode = 1;
              return;
            }
            if (
              options.requireApprovalRisk.length > 0 &&
              options.requireApprovalRisk.length !==
                options.requireApprovalTool.length
            ) {
              writeErr(
                "error: --require-approval-risk must be provided once for each --require-approval-tool"
              );
              process.exitCode = 1;
              return;
            }
            const path = io.mandateStorePath ?? resolveMandateStorePath();

            try {
              const mandate = await createMandate({
                path,
                task,
                repoPath,
                worktreePath: gitBinding?.worktreePath ?? repoPath,
                branch,
                agentRole: options.agent,
                profiles,
                lease: options.lease,
                allowedTools: options.allowTool,
                deniedTools: options.denyTool,
                approvalRequiredTools: options.requireApprovalTool.map(
                  (toolPattern, index) => ({
                    toolPattern,
                    ...(options.requireApprovalReason[index]
                      ? { reason: options.requireApprovalReason[index] }
                      : {}),
                    ...(options.requireApprovalRisk[index]
                      ? { risk: options.requireApprovalRisk[index] }
                      : {}),
                    ...(options.requireApprovalLabel.length > 0
                      ? { labels: options.requireApprovalLabel }
                      : {})
                  })
                )
              });
              if (options.json) {
                writeOut(
                  JSON.stringify(
                    {
                      path,
                      mandate,
                      mcpLaunch: createMandateMcpLaunchPayload(mandate)
                    },
                    null,
                    2
                  )
                );
              } else {
                writeOut(formatMandateCreated(path, mandate));
              }
            } catch (error) {
              writeErr(`error: ${messageFromError(error)}`);
              process.exitCode = 1;
            }
          }
        )
    )
    .addCommand(
      new Command("child")
        .description("Create a child mandate narrowed from an active parent.")
        .argument("<task>", "child task name or summary")
        .requiredOption("--parent <id>", "active parent mandate id")
        .requiredOption("--agent <role>", "agent role for this child mandate")
        .requiredOption(
          "--profiles <profiles>",
          "comma-separated Switchboard profiles to bind"
        )
        .requiredOption("--branch <branch>", "branch the child mandate is scoped to")
        .requiredOption("--lease <duration>", "lease duration, like 30m, 2h, or 1d")
        .option("--delegated-by <actor>", "actor creating the child mandate")
        .option(
          "--allow-tool <pattern>",
          "allow a namespaced tool pattern (repeatable)",
          collectOption,
          [] as string[]
        )
        .option(
          "--deny-tool <pattern>",
          "deny a namespaced tool pattern (repeatable)",
          collectOption,
          [] as string[]
        )
        .option(
          "--require-approval-tool <pattern>",
          "require approval for a namespaced tool pattern (repeatable)",
          collectOption,
          [] as string[]
        )
        .option(
          "--require-approval-reason <reason>",
          "human reason for a required approval gate (repeatable, matches --require-approval-tool order)",
          collectOption,
          [] as string[]
        )
        .option(
          "--require-approval-risk <risk>",
          "risk class for a required approval gate: low, medium, high, or critical (repeatable, matches --require-approval-tool order)",
          collectOption,
          [] as string[]
        )
        .option(
          "--require-approval-label <label>",
          "structured label for approval gates (repeatable, applies to every approval gate)",
          collectOption,
          [] as string[]
        )
        .option("--json", "print machine-readable JSON")
        .action(
          async (
            task: string,
            options: {
              parent: string;
              agent: string;
              profiles: string;
              branch: string;
              lease: string;
              delegatedBy?: string;
              allowTool: string[];
              denyTool: string[];
              requireApprovalTool: string[];
              requireApprovalReason: string[];
              requireApprovalRisk: string[];
              requireApprovalLabel: string[];
              json?: boolean;
            }
          ) => {
            const globalOptions = program.opts<{ cwd?: string }>();
            const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
            if (!validateLoadedConfigForCommand(loaded, writeErr)) {
              return;
            }

            const profiles = parseCommaSeparatedList(options.profiles);
            const missingProfiles = profiles.filter(
              (profile) => !loaded.config.profiles[profile]
            );
            if (missingProfiles.length > 0) {
              writeErr(
                `error: child mandate profiles were not found: ${missingProfiles.join(", ")}`
              );
              process.exitCode = 1;
              return;
            }

            const repoPath = configCwdBase(loaded, globalOptions.cwd);
            let gitBinding: { worktreePath: string; branch: string } | undefined;
            try {
              gitBinding = resolveGitWorktreeBinding(repoPath);
            } catch (error) {
              writeErr(`error: ${messageFromError(error)}`);
              process.exitCode = 1;
              return;
            }
            const branch = options.branch.trim();
            if (gitBinding && gitBinding.branch !== branch) {
              writeErr(
                `error: child mandate branch "${branch}" does not match current git branch "${gitBinding.branch}" in ${gitBinding.worktreePath}`
              );
              process.exitCode = 1;
              return;
            }
            if (
              options.requireApprovalReason.length > 0 &&
              options.requireApprovalReason.length !==
                options.requireApprovalTool.length
            ) {
              writeErr(
                "error: --require-approval-reason must be provided once for each --require-approval-tool"
              );
              process.exitCode = 1;
              return;
            }
            if (
              options.requireApprovalRisk.length > 0 &&
              options.requireApprovalRisk.length !==
                options.requireApprovalTool.length
            ) {
              writeErr(
                "error: --require-approval-risk must be provided once for each --require-approval-tool"
              );
              process.exitCode = 1;
              return;
            }
            const path = io.mandateStorePath ?? resolveMandateStorePath();

            try {
              const mandate = await createChildMandate({
                path,
                parentId: options.parent,
                task,
                repoPath,
                worktreePath: gitBinding?.worktreePath ?? repoPath,
                branch,
                agentRole: options.agent,
                profiles,
                lease: options.lease,
                ...(options.delegatedBy
                  ? { delegatedBy: options.delegatedBy }
                  : {}),
                allowedTools: options.allowTool,
                deniedTools: options.denyTool,
                approvalRequiredTools: options.requireApprovalTool.map(
                  (toolPattern, index) => ({
                    toolPattern,
                    ...(options.requireApprovalReason[index]
                      ? { reason: options.requireApprovalReason[index] }
                      : {}),
                    ...(options.requireApprovalRisk[index]
                      ? { risk: options.requireApprovalRisk[index] }
                      : {}),
                    ...(options.requireApprovalLabel.length > 0
                      ? { labels: options.requireApprovalLabel }
                      : {})
                  })
                )
              });
              if (options.json) {
                writeOut(
                  JSON.stringify(
                    {
                      path,
                      mandate,
                      mcpLaunch: createMandateMcpLaunchPayload(mandate)
                    },
                    null,
                    2
                  )
                );
              } else {
                writeOut(formatMandateCreated(path, mandate));
              }
            } catch (error) {
              writeErr(`error: ${messageFromError(error)}`);
              process.exitCode = 1;
            }
          }
        )
    )
    .addCommand(
      new Command("handoff")
        .description("Close a mandate with a local handoff report.")
        .argument("<id>", "mandate id to hand off")
        .requiredOption(
          "--state <state>",
          "handoff state: completed, blocked, or cancelled"
        )
        .option("--summary <text>", "short handoff summary")
        .option(
          "--next-step <text>",
          "next step for the human or harness (repeatable)",
          collectOption,
          [] as string[]
        )
        .option(
          "--artifact <value>",
          "handoff artifact such as a PR, log, or deployment URL (repeatable)",
          collectOption,
          [] as string[]
        )
        .option("--by <actor>", "actor writing the handoff report")
        .option("--json", "print machine-readable JSON")
        .action(
          async (
            id: string,
            options: {
              state: string;
              summary?: string;
              nextStep: string[];
              artifact: string[];
              by?: string;
              json?: boolean;
            }
          ) => {
            const state = parseHandoffState(options.state);
            if (!state) {
              writeErr(
                "error: --state must be completed, blocked, or cancelled"
              );
              process.exitCode = 1;
              return;
            }

            const globalOptions = program.opts<{ cwd?: string }>();
            const repoPath = installTargetCwd(globalOptions.cwd);
            const path = io.mandateStorePath ?? resolveMandateStorePath();
            try {
              const mandate = await updateMandateHandoff({
                path,
                id,
                repoPath,
                state,
                ...(options.summary ? { summary: options.summary } : {}),
                nextSteps: options.nextStep,
                artifacts: options.artifact,
                ...(options.by ? { handoffBy: options.by } : {})
              });
              const result = { path, mandate };
              writeOut(
                options.json
                  ? JSON.stringify(result, null, 2)
                  : formatMandateHandoff(path, mandate)
              );
            } catch (error) {
              writeErr(`error: ${messageFromError(error)}`);
              process.exitCode = 1;
            }
          }
        )
    )
    .addCommand(
      new Command("report")
        .description("Show a mandate tree handoff report.")
        .argument("<id>", "root or child mandate id to report")
        .option("--json", "print machine-readable JSON")
        .option("--all", "search mandates for all repos")
        .option("--log-limit <count>", "maximum related audit entries", "20")
        .action(
          async (
            id: string,
            options: { json?: boolean; all?: boolean; logLimit: string }
          ) => {
            const logLimit = parsePositiveInteger(options.logLimit);
            if (logLimit === undefined) {
              writeErr("error: --log-limit must be a positive integer");
              process.exitCode = 1;
              return;
            }

            const globalOptions = program.opts<{ cwd?: string }>();
            const repoPath = options.all
              ? undefined
              : installTargetCwd(globalOptions.cwd);
            const path = io.mandateStorePath ?? resolveMandateStorePath();
            const auditLogPath = io.auditLogPath ?? resolveAuditLogPath();
            const approvalStorePath =
              io.approvalStorePath ?? resolveApprovalRequestStorePath();
            try {
              const report = await createMandateReportPayload({
                id,
                path,
                auditLogPath,
                approvalStorePath,
                logLimit,
                ...(repoPath ? { repoPath } : {})
              });
              writeOut(
                options.json
                  ? JSON.stringify(report, null, 2)
                  : formatMandateReport(report)
              );
            } catch (error) {
              writeErr(`error: ${messageFromError(error)}`);
              process.exitCode = 1;
            }
          }
        )
    )
    .addCommand(
      new Command("status")
        .description("Show local task-scoped mandates.")
        .argument("[id]", "mandate id to inspect")
        .option("--json", "print machine-readable JSON")
        .option("--all", "show mandates for all repos")
        .action(
          async (
            id: string | undefined,
            options: { json?: boolean; all?: boolean }
          ) => {
            const globalOptions = program.opts<{ cwd?: string }>();
            const repoPath = options.all
              ? undefined
              : installTargetCwd(globalOptions.cwd);
            const path = io.mandateStorePath ?? resolveMandateStorePath();
            const mandates = await listMandates({
              path,
              ...(repoPath ? { repoPath } : {}),
              ...(id ? { id } : {})
            });
            const result = {
              schemaVersion: mandateStatusSchemaVersion,
              path,
              repoPath: repoPath ?? null,
              mandates
            };

            if (id && mandates.length === 0) {
              writeErr(`error: mandate "${id}" was not found`);
              process.exitCode = 1;
              return;
            }

            if (options.json) {
              writeOut(JSON.stringify(result, null, 2));
            } else {
              writeOut(formatMandateStatus(result));
            }
          }
        )
    );

  program
    .command("approvals")
    .description("Show local mandate approval requests.")
    .option("--json", "print machine-readable JSON")
    .option("--all", "show approval requests for all repos")
    .option("--mandate <id>", "filter approval requests by mandate id")
    .option(
      "--include-children",
      "with --mandate, include approval requests for child mandates"
    )
    .option(
      "--status <status>",
      "filter by runtime status: pending, approved, denied, stale, or expired"
    )
    .action(
      async (options: {
        json?: boolean;
        all?: boolean;
        mandate?: string;
        includeChildren?: boolean;
        status?: "pending" | "approved" | "denied" | "stale" | "expired";
      }) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const repoPath = options.all
          ? undefined
          : installTargetCwd(globalOptions.cwd);
        if (
          options.status &&
          !["pending", "approved", "denied", "stale", "expired"].includes(options.status)
        ) {
          writeErr(
            "error: --status must be pending, approved, denied, stale, or expired"
          );
          process.exitCode = 1;
          return;
        }
        if (options.includeChildren && !options.mandate) {
          writeErr("error: --include-children requires --mandate <id>");
          process.exitCode = 1;
          return;
        }
        if (options.includeChildren && options.all) {
          writeErr("error: --include-children must be repo-scoped; remove --all");
          process.exitCode = 1;
          return;
        }
        const path = io.approvalStorePath ?? resolveApprovalRequestStorePath();
        const mandateStorePath = io.mandateStorePath ?? resolveMandateStorePath();
        try {
          const result = await createApprovalRequestsPayload({
            path,
            mandateStorePath,
            ...(repoPath ? { repoPath } : {}),
            ...(options.mandate ? { mandateId: options.mandate } : {}),
            includeChildren: options.includeChildren ?? false,
            ...(options.status ? { status: options.status } : {})
          });

          if (options.json) {
            writeOut(JSON.stringify(result, null, 2));
          } else {
            writeOut(formatApprovalRequests(result));
          }
        } catch (error) {
          writeErr(`error: ${messageFromError(error)}`);
          process.exitCode = 1;
        }
      }
    );

  program
    .command("approve <id>")
    .description("Approve a local mandate approval request.")
    .option("--reason <reason>", "optional decision reason")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        id: string,
        options: {
          reason?: string;
          json?: boolean;
        }
      ) => {
        await decideApprovalRequestForCommand(id, "approved", options);
      }
    );

  program
    .command("deny <id>")
    .description("Deny a local mandate approval request.")
    .option("--reason <reason>", "optional decision reason")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        id: string,
        options: {
          reason?: string;
          json?: boolean;
        }
      ) => {
        await decideApprovalRequestForCommand(id, "denied", options);
      }
    );

  program
    .command("logs")
    .description("Show local Switchboard audit log entries.")
    .option("--json", "print machine-readable JSON")
    .option("--limit <count>", "maximum entries to print", "20")
    .option("--mandate <id>", "filter entries by mandate id")
    .action(async (options: { json?: boolean; limit: string; mandate?: string }) => {
      const limit = parsePositiveInteger(options.limit);
      if (limit === undefined) {
        writeErr("error: --limit must be a positive integer");
        process.exitCode = 1;
        return;
      }

      const path = io.auditLogPath ?? resolveAuditLogPath();
      const entries = await readAuditLogEntries({
        path,
        limit,
        ...(options.mandate ? { mandateId: options.mandate } : {})
      });
      if (options.json) {
        writeOut(
          JSON.stringify(
            { path, mandateId: options.mandate ?? null, entries },
            null,
            2
          )
        );
        return;
      }

      writeOut(formatAuditLogs(path, entries));
    });

  program
    .command("install <client>")
    .description(
      "Print or write an MCP client config snippet for routing through Switchboard."
    )
    .option("--json", "print machine-readable JSON")
    .option("--write", "write project-scoped client config")
    .option("--rollback <backup>", "restore project-scoped client config backup")
    .option("--server-name <name>", "MCP server name to register", "switchboard")
    .option("--command <command>", "Switchboard executable command", "switchboard")
    .action(
      async (
        client: string,
        options: {
          json?: boolean;
          write?: boolean;
          rollback?: string;
          serverName: string;
          command: string;
        }
      ) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const supportedClient = parseSupportedClient(client);
        if (!supportedClient) {
          writeErr("error: supported install clients are: codex, claude");
          process.exitCode = 1;
          return;
        }

        const rollbackCwd = installTargetCwd(globalOptions.cwd);
        if (options.write && options.rollback) {
          writeErr("error: use either --write or --rollback, not both");
          process.exitCode = 1;
          return;
        }

        if (options.rollback) {
          try {
            const result = await rollbackSwitchboardClientConfig({
              client: supportedClient,
              cwd: rollbackCwd,
              backupPath: isAbsolute(options.rollback)
                ? options.rollback
                : resolve(rollbackCwd, options.rollback)
            });
            writeOut(
              options.json
                ? JSON.stringify(result, null, 2)
                : formatInstallRollback(result)
            );
          } catch (error) {
            writeErr(`error: ${messageFromError(error)}`);
            process.exitCode = 1;
          }
          return;
        }

        const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
        if (!validateLoadedConfigForCommand(loaded, writeErr)) {
          return;
        }

        const cwd = configCwdBase(loaded, globalOptions.cwd);
        const profiles = stdioProfilesFromConfig(loaded.config.profiles, cwd);
        if (profiles.length === 0) {
          writeErr("error: no stdio upstream profiles are configured");
          process.exitCode = 1;
          return;
        }

        const clientConfigOptions = {
          client: supportedClient,
          serverName: options.serverName,
          command: options.command,
          cwd
        };
        const installValidation =
          validateSwitchboardClientConfigOptions(clientConfigOptions);
        if (!installValidation.ok) {
          for (const error of installValidation.errors) {
            writeErr(`error: ${error}`);
          }
          process.exitCode = 1;
          return;
        }

        const rendered = renderSwitchboardClientConfig(clientConfigOptions);

        if (options.write) {
          try {
            const result =
              await writeSwitchboardClientConfig(clientConfigOptions);
            writeOut(
              options.json
                ? JSON.stringify(result, null, 2)
                : formatInstallWrite(result)
            );
          } catch (error) {
            writeErr(`error: ${messageFromError(error)}`);
            process.exitCode = 1;
          }
          return;
        }

        if (options.json) {
          writeOut(JSON.stringify(rendered, null, 2));
          return;
        }

        writeOut(formatInstallSnippet(rendered));
      }
    );

  return program;
}

function formatStatus(status: {
  globalConfigPath: string;
  repoConfigPath: string | null;
  repoLocalConfigPath: string | null;
  profileCount: number;
  workspaceCount: number;
  namespaces: Array<{ profile: string; namespace: string; generated: boolean }>;
  diagnostics: Array<{ level: string; message: string }>;
}): string {
  const lines = [
    "Switchboard status",
    `Global config: ${status.globalConfigPath}`,
    `Repo config: ${status.repoConfigPath ?? "not found"}`,
    `Repo local config: ${status.repoLocalConfigPath ?? "not found"}`,
    `Profiles: ${status.profileCount}`,
    `Workspaces: ${status.workspaceCount}`
  ];

  if (status.namespaces.length > 0) {
    lines.push("", "Namespaces:");
    for (const item of status.namespaces) {
      const label = item.generated ? "generated" : "explicit";
      lines.push(`  ${item.profile} -> ${item.namespace} (${label})`);
    }
  }

  if (status.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of status.diagnostics) {
      lines.push(`  ${diagnostic.level}: ${diagnostic.message}`);
    }
  }

  return lines.join("\n");
}

function formatDoctor(result: {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message: string }>;
  diagnostics: Array<{ level: string; message: string }>;
  clientConfigs?: ProjectClientConfigInspection[];
  nextSteps: string[];
}): string {
  const lines = [
    result.ok ? "Switchboard doctor: OK" : "Switchboard doctor: failed"
  ];

  for (const check of result.checks) {
    lines.push(`${check.ok ? "ok" : "fail"} ${check.name} - ${check.message}`);
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.level}: ${diagnostic.message}`);
  }

  if (result.clientConfigs && result.clientConfigs.length > 0) {
    lines.push("", "Client configs:");
    for (const config of result.clientConfigs) {
      const otherServers =
        config.otherServerNames.length > 0
          ? `; other MCP servers: ${config.otherServerNames.join(", ")}`
          : "";
      lines.push(
        `  ${config.client}: ${config.status} - ${config.message}${otherServers} (${config.targetPath})`
      );
    }
  }

  if (result.nextSteps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of result.nextSteps) {
      lines.push(`  ${step}`);
    }
  }

  return lines.join("\n");
}

function clientConfigSummary(configs: ProjectClientConfigInspection[]): string {
  const installed = configs.filter((item) => item.status === "installed").length;
  const invalid = configs.filter((item) => item.status === "invalid").length;

  if (invalid > 0) {
    return `${invalid} project client config file(s) could not be inspected.`;
  }

  return `${installed}/${configs.length} project client config(s) route through switchboard mcp.`;
}

function formatInit(result: {
  path: string;
  written: boolean;
  overwritten: boolean;
  content: string;
}): string {
  const header = result.written
    ? result.overwritten
      ? `Overwrote ${result.path}`
      : `Wrote ${result.path}`
    : `Switchboard init dry run for ${result.path}`;

  return [header, "", result.content].join("\n");
}

function formatDaemonStatus(status: Awaited<ReturnType<typeof daemonStatus>>): string {
  const lines = [`Switchboard daemon: ${status.state}`];
  lines.push(`Runtime dir: ${status.paths.runtimeDir}`);
  lines.push(`Socket: ${status.paths.socketPath}`);

  if ("daemon" in status) {
    lines.push(`PID: ${status.daemon.pid}`);
    lines.push(`Started: ${status.daemon.startedAt}`);
  }
  if ("error" in status) {
    lines.push(`Error: ${status.error}`);
  }

  return lines.join("\n");
}

function formatDaemonStart(result: StartDaemonResult): string {
  return [result.message, formatDaemonStatus(result.status)].join("\n");
}

function formatDaemonStop(result: StopDaemonResult): string {
  return [result.message, formatDaemonStatus(result.status)].join("\n");
}

function formatDaemonTools(
  tools: Awaited<ReturnType<typeof listDaemonTools>>["tools"]
): string {
  const lines = ["Switchboard daemon tools", `Tools: ${tools.length}`];

  if (tools.length > 0) {
    lines.push("");
    for (const tool of tools) {
      lines.push(`  ${tool.name} (${tool.profileName})`);
    }
  }

  return lines.join("\n");
}

function formatToolSurface(result: {
  mandate: { id: string; runtimeStatus: string } | null;
  profileCount: number;
  toolCount: number;
  approvalRequiredCount: number;
  tools: NamespacedTool[];
}): string {
  const lines = [
    "Switchboard tools",
    `Mandate: ${
      result.mandate
        ? `${result.mandate.id} (${result.mandate.runtimeStatus})`
        : "none"
    }`,
    `Profiles: ${result.profileCount}`,
    `Tools: ${result.toolCount}`,
    `Approval required: ${result.approvalRequiredCount}`
  ];

  if (result.tools.length > 0) {
    lines.push("", "Tool names:");
    for (const tool of result.tools) {
      const approval = hasApprovalRequiredMetadata(tool)
        ? " approval-required"
        : "";
      lines.push(`  ${tool.name} (${tool.profileName})${approval}`);
    }
  }

  return lines.join("\n");
}

function formatProfileTest(result: StdioProfileTestResult): string {
  const lines = [
    `Switchboard profile test: ${result.ok ? "OK" : "failed"}`,
    `Profile: ${result.profileName}`,
    `Namespace: ${result.namespace}`,
    `Tools: ${result.toolCount}`
  ];

  if (result.tools.length > 0) {
    lines.push("", "Tool names:");
    for (const tool of result.tools) {
      lines.push(`  ${tool.name}`);
    }
  }

  return lines.join("\n");
}

function hasApprovalRequiredMetadata(tool: NamespacedTool): boolean {
  return isRecord(tool._meta?.switchboard)
    ? isRecord(tool._meta.switchboard.approvalRequired)
    : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMandateCreated(path: string, mandate: MandateWithStatus): string {
  return [
    `Created mandate ${mandate.id}`,
    `Task: ${mandate.task}`,
    ...(mandate.parentMandateId
      ? [
          `Parent: ${mandate.parentMandateId}`,
          `Delegated by: ${mandate.delegatedBy ?? "unknown"}`,
          `Delegation path: ${mandate.delegationPath?.join(" -> ") ?? mandate.id}`
        ]
      : []),
    `Agent: ${mandate.agentRole}`,
    `Repo: ${mandate.repoPath}`,
    `Worktree: ${mandate.worktreePath}`,
    `Branch: ${mandate.branch}`,
    `Profiles: ${mandate.profiles.join(", ")}`,
    `Allowed tools: ${mandate.allowedTools.length > 0 ? mandate.allowedTools.join(", ") : "all"}`,
    `Denied tools: ${mandate.deniedTools.length > 0 ? mandate.deniedTools.join(", ") : "none"}`,
    `Approval gates: ${formatApprovalGates(mandate.approvalGates)}`,
    `Lease: ${mandate.lease}`,
    `Status: ${mandate.runtimeStatus}`,
    `Expires: ${mandate.expiresAt}`,
    `Store: ${path}`
  ].join("\n");
}

function createMandateMcpLaunchPayload(
  mandate: MandateWithStatus
): MandateMcpLaunchPayload {
  return {
    schemaVersion: mandateMcpLaunchSchemaVersion,
    transport: "stdio",
    mandateId: mandate.id,
    cwd: mandate.repoPath,
    command: "switchboard",
    args: ["--cwd", mandate.repoPath, "mcp", "--mandate", mandate.id]
  };
}

function mandateAuditContext(mandate: MandateWithStatus): {
  mandateUid?: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
} {
  return {
    ...(mandate.mandateUid ? { mandateUid: mandate.mandateUid } : {}),
    repoPath: mandate.repoPath,
    worktreePath: mandate.worktreePath,
    branch: mandate.branch
  };
}

async function createMandateReportPayload(options: {
  id: string;
  path: string;
  auditLogPath: string;
  approvalStorePath: string;
  logLimit: number;
  repoPath?: string;
}): Promise<MandateReportPayload> {
  const selectedMandateId = normalizeMandateId(options.id);
  if (!selectedMandateId) {
    throw new Error("mandate id is required");
  }
  const mandates = await listMandates({
    path: options.path,
    ...(options.repoPath ? { repoPath: options.repoPath } : {})
  });
  const selected = findLatestMandate(mandates, selectedMandateId);
  if (!selected) {
    throw new Error(`mandate "${selectedMandateId}" was not found`);
  }

  const selectedMandateUid = mandateUidForReport(selected);
  const rootMandateUid = selected.delegationUids?.[0] ?? selectedMandateUid;
  const rootMandateId = selected.delegationPath?.[0] ?? selected.id;
  const chain = mandateChainForRoot(mandates, {
    rootMandateId,
    rootMandateUid
  });
  const mandateIds = new Set(chain.map((mandate) => mandate.id));
  const mandateUids = new Set(
    chain.flatMap((mandate) =>
      mandate.mandateUid ? [mandate.mandateUid] : []
    )
  );
  const auditEntries = (
    await readAuditLogEntries({ path: options.auditLogPath })
  ).filter((entry) => {
    if (options.repoPath && entry.repoPath !== options.repoPath) {
      return false;
    }
    if (!entry.mandateId || !mandateIds.has(entry.mandateId)) {
      return false;
    }
    if (entry.mandateUid && mandateUids.size > 0) {
      return mandateUids.has(entry.mandateUid);
    }
    return true;
  });
  const limitedAuditEntries = auditEntries.slice(
    Math.max(auditEntries.length - options.logLimit, 0)
  );
  const approvalRequests = (
    await listApprovalRequests({
      path: options.approvalStorePath,
      ...(options.repoPath ? { repoPath: options.repoPath } : {}),
      ...(rootMandateUid ? { rootMandateUid } : {})
    })
  ).filter((request) => {
    if (!request.mandateId || !mandateIds.has(request.mandateId)) {
      return false;
    }
    if (mandateUids.size > 0) {
      return request.mandateUid ? mandateUids.has(request.mandateUid) : false;
    }
    return true;
  });

  return {
    schemaVersion: mandateReportSchemaVersion,
    path: options.path,
    auditLogPath: options.auditLogPath,
    repoPath: options.repoPath ?? null,
    selectedMandateId,
    selectedMandateUid,
    rootMandateId,
    rootMandateUid,
    generatedAt: new Date().toISOString(),
    counts: {
      mandates: chain.length,
      open: chain.filter((mandate) => mandate.handoffState === "open").length,
      completed: chain.filter((mandate) => mandate.handoffState === "completed")
        .length,
      blocked: chain.filter((mandate) => mandate.handoffState === "blocked")
        .length,
      cancelled: chain.filter((mandate) => mandate.handoffState === "cancelled")
        .length,
      active: chain.filter((mandate) => mandate.runtimeStatus === "active")
        .length,
      expired: chain.filter((mandate) => mandate.runtimeStatus === "expired")
        .length,
      closed: chain.filter((mandate) => mandate.runtimeStatus === "closed")
        .length,
      auditEntries: limitedAuditEntries.length,
      approvalRequests: approvalRequests.length
    },
    childrenByParent: childrenByParent(chain),
    mandates: chain,
    approvalRequests,
    auditEntries: limitedAuditEntries
  };
}

function findLatestMandate(
  mandates: MandateWithStatus[],
  id: string
): MandateWithStatus | undefined {
  for (let index = mandates.length - 1; index >= 0; index -= 1) {
    const mandate = mandates[index];
    if (mandate?.id === id) {
      return mandate;
    }
  }

  return undefined;
}

function mandateChainForRoot(
  mandates: MandateWithStatus[],
  root: { rootMandateId: string; rootMandateUid: string | null }
): MandateWithStatus[] {
  const chainIds = new Set([root.rootMandateId]);
  const chainUids = new Set(root.rootMandateUid ? [root.rootMandateUid] : []);
  const chain: MandateWithStatus[] = [];

  for (const mandate of mandates) {
    const delegationPath = mandate.delegationPath ?? [];
    const delegationUids = mandate.delegationUids ?? [];
    const isInChain = root.rootMandateUid
      ? mandate.mandateUid === root.rootMandateUid ||
        mandate.parentMandateUid === root.rootMandateUid ||
        delegationUids.includes(root.rootMandateUid) ||
        (mandate.parentMandateUid
          ? chainUids.has(mandate.parentMandateUid)
          : false)
      : mandate.id === root.rootMandateId ||
        mandate.parentMandateId === root.rootMandateId ||
        delegationPath.includes(root.rootMandateId) ||
        (mandate.parentMandateId ? chainIds.has(mandate.parentMandateId) : false);
    if (isInChain) {
      chain.push(mandate);
      chainIds.add(mandate.id);
      if (mandate.mandateUid) {
        chainUids.add(mandate.mandateUid);
      }
    }
  }

  return chain.sort((left, right) => {
    const leftDepth = left.delegationPath?.length ?? 1;
    const rightDepth = right.delegationPath?.length ?? 1;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function mandateUidForReport(mandate: MandateWithStatus): string | null {
  return mandate.mandateUid ?? null;
}

function childrenByParent(
  mandates: MandateWithStatus[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const mandate of mandates) {
    if (!mandate.parentMandateId) {
      continue;
    }

    result[mandate.parentMandateId] = [
      ...(result[mandate.parentMandateId] ?? []),
      mandate.id
    ];
  }

  return result;
}

async function createApprovalRequestsPayload(options: {
  path: string;
  mandateStorePath: string;
  repoPath?: string;
  mandateId?: string;
  includeChildren: boolean;
  status?: ApprovalRequestWithStatus["runtimeStatus"];
}): Promise<ApprovalRequestsPayload> {
  const baseRequests = await listApprovalRequests({
    path: options.path,
    ...(options.repoPath ? { repoPath: options.repoPath } : {}),
    ...(options.includeChildren || !options.mandateId
      ? {}
      : { mandateId: options.mandateId }),
    ...(options.status ? { status: options.status } : {})
  });

  let mandates: MandateWithStatus[] = [];
  let rootMandateId: string | null = null;
  let rootMandateUid: string | null = null;
  let requests = baseRequests;

  if (options.includeChildren) {
    const selectedMandateId = normalizeMandateId(options.mandateId ?? "");
    if (!selectedMandateId) {
      throw new Error("mandate id is required");
    }
    const allMandates = await listMandates({
      path: options.mandateStorePath,
      ...(options.repoPath ? { repoPath: options.repoPath } : {})
    });
    const selected = findLatestMandate(allMandates, selectedMandateId);
    if (!selected) {
      throw new Error(`mandate "${selectedMandateId}" was not found`);
    }
    rootMandateId = selected.delegationPath?.[0] ?? selected.id;
    rootMandateUid = selected.delegationUids?.[0] ?? mandateUidForReport(selected);
    mandates = mandateChainForRoot(allMandates, {
      rootMandateId,
      rootMandateUid
    });
    const mandateIds = new Set(mandates.map((mandate) => mandate.id));
    const mandateUids = new Set(
      mandates.flatMap((mandate) =>
        mandate.mandateUid ? [mandate.mandateUid] : []
      )
    );
    requests = baseRequests.filter((request) => {
      if (!mandateIds.has(request.mandateId)) {
        return false;
      }
      if (mandateUids.size > 0) {
        return request.mandateUid ? mandateUids.has(request.mandateUid) : false;
      }
      return true;
    });
  }

  return {
    schemaVersion: approvalRequestsSchemaVersion,
    path: options.path,
    mandateStorePath: options.includeChildren ? options.mandateStorePath : null,
    repoPath: options.repoPath ?? null,
    mandateId: options.mandateId ?? null,
    includeChildren: options.includeChildren,
    rootMandateId,
    rootMandateUid,
    childrenByParent: options.includeChildren ? childrenByParent(mandates) : {},
    counts: {
      requests: requests.length,
      pending: requests.filter((request) => request.runtimeStatus === "pending")
        .length,
      approved: requests.filter((request) => request.runtimeStatus === "approved")
        .length,
      denied: requests.filter((request) => request.runtimeStatus === "denied")
        .length,
      stale: requests.filter((request) => request.runtimeStatus === "stale")
        .length,
      expired: requests.filter((request) => request.runtimeStatus === "expired")
        .length
    },
    mandates,
    requests
  };
}

function formatMandateStatus(result: {
  path: string;
  repoPath: string | null;
  mandates: MandateWithStatus[];
}): string {
  const lines = [
    "Switchboard mandates",
    `Store: ${result.path}`,
    `Repo: ${result.repoPath ?? "all"}`
  ];

  if (result.mandates.length === 0) {
    lines.push("", "No mandates found.");
    return lines.join("\n");
  }

  lines.push("");
  for (const mandate of result.mandates) {
    lines.push(
      [
        mandate.id,
        mandate.runtimeStatus,
        mandate.agentRole,
        mandate.branch,
        ...(mandate.parentMandateId
          ? [
              `parent:${mandate.parentMandateId}`,
              `delegated-by:${mandate.delegatedBy ?? "unknown"}`,
              `path:${mandate.delegationPath?.join(">") ?? mandate.id}`
            ]
          : []),
        `profiles:${mandate.profiles.join(",")}`,
        `allow:${mandate.allowedTools.length > 0 ? mandate.allowedTools.join(",") : "all"}`,
        `deny:${mandate.deniedTools.length > 0 ? mandate.deniedTools.join(",") : "none"}`,
        `approval:${formatApprovalGates(mandate.approvalGates, ",")}`,
        `handoff:${mandate.handoffState}`,
        `expires:${mandate.expiresAt}`
      ].join(" ")
    );
  }

  return lines.join("\n");
}

function formatMandateHandoff(path: string, mandate: MandateWithStatus): string {
  return [
    `Updated mandate ${mandate.id}`,
    `State: ${mandate.handoffState}`,
    `Runtime: ${mandate.runtimeStatus}`,
    ...(mandate.handoffSummary ? [`Summary: ${mandate.handoffSummary}`] : []),
    ...(mandate.handoffNextSteps && mandate.handoffNextSteps.length > 0
      ? [`Next steps: ${mandate.handoffNextSteps.join("; ")}`]
      : []),
    ...(mandate.handoffArtifacts && mandate.handoffArtifacts.length > 0
      ? [`Artifacts: ${mandate.handoffArtifacts.join(", ")}`]
      : []),
    ...(mandate.handoffBy ? [`By: ${mandate.handoffBy}`] : []),
    ...(mandate.handoffAt ? [`At: ${mandate.handoffAt}`] : []),
    `Store: ${path}`
  ].join("\n");
}

function formatMandateReport(report: MandateReportPayload): string {
  const lines = [
    "Switchboard mandate report",
    `Store: ${report.path}`,
    `Audit log: ${report.auditLogPath}`,
    `Repo: ${report.repoPath ?? "all"}`,
    `Root: ${report.rootMandateId}`,
    `Selected: ${report.selectedMandateId}`,
    `Mandates: ${report.counts.mandates} open:${report.counts.open} completed:${report.counts.completed} blocked:${report.counts.blocked} cancelled:${report.counts.cancelled}`,
    `Runtime: active:${report.counts.active} expired:${report.counts.expired} closed:${report.counts.closed}`,
    `Approval requests: ${report.counts.approvalRequests}`,
    `Audit entries: ${report.counts.auditEntries}`
  ];

  if (report.mandates.length > 0) {
    lines.push("", "Mandate chain:");
    for (const mandate of report.mandates) {
      const parent = mandate.parentMandateId
        ? ` parent:${mandate.parentMandateId}`
        : "";
      lines.push(
        `  ${mandate.id} state:${mandate.handoffState} runtime:${mandate.runtimeStatus}${parent} role:${mandate.agentRole}`
      );
      if (mandate.handoffSummary) {
        lines.push(`    ${mandate.handoffSummary}`);
      }
    }
  }

  if (report.auditEntries.length > 0) {
    lines.push("", "Recent audit entries:");
    for (const entry of report.auditEntries) {
      lines.push(
        `  ${entry.timestamp} ${entry.status} mandate:${entry.mandateId ?? "none"} ${entry.action}${entry.toolName ? ` ${entry.toolName}` : ""}`
      );
    }
  }

  return lines.join("\n");
}

function formatApprovalGates(
  gates: MandateWithStatus["approvalGates"],
  separator = ", "
): string {
  if (gates.length === 0) {
    return "none";
  }

  return gates
    .map((gate) => {
      const metadata = [
        ...(gate.risk ? [`risk:${gate.risk}`] : []),
        ...(gate.labels && gate.labels.length > 0
          ? [`labels:${gate.labels.join("+")}`]
          : []),
        ...(gate.reason ? [`reason:${gate.reason}`] : [])
      ];
      return metadata.length > 0
        ? `${gate.id}:${gate.toolPattern}(${metadata.join(" ")})`
        : `${gate.id}:${gate.toolPattern}`;
    })
    .join(separator);
}

function formatApprovalRequests(result: {
  path: string;
  repoPath: string | null;
  requests: ApprovalRequestWithStatus[];
}): string {
  const lines = [
    "Switchboard approval requests",
    `Store: ${result.path}`,
    `Repo: ${result.repoPath ?? "all"}`
  ];

  if (result.requests.length === 0) {
    lines.push("", "No approval requests found.");
    return lines.join("\n");
  }

  lines.push("");
  for (const request of result.requests) {
    lines.push(
      [
        request.id,
        request.runtimeStatus,
        `mandate:${request.mandateId}`,
        ...(request.parentMandateId ? [`parent:${request.parentMandateId}`] : []),
        ...(request.delegatedBy ? [`delegated-by:${request.delegatedBy}`] : []),
        ...(request.delegationPath
          ? [`path:${request.delegationPath.join(">")}`]
          : []),
        `branch:${request.branch}`,
        `tool:${request.toolName}`,
        `gate:${request.approvalGateId}:${request.approvalGatePattern}`,
        ...(request.approvalGateRisk ? [`risk:${request.approvalGateRisk}`] : []),
        ...(request.approvalGateLabels && request.approvalGateLabels.length > 0
          ? [`labels:${request.approvalGateLabels.join("+")}`]
          : []),
        ...(request.approvalGateReason ? [`reason:${request.approvalGateReason}`] : []),
        `expires:${request.expiresAt}`
      ].join(" ")
    );
    const nextAction = approvalRequestNextAction(request);
    if (nextAction) {
      lines.push(`  next: ${nextAction}`);
    }
  }

  return lines.join("\n");
}

function approvalRequestNextAction(
  request: ApprovalRequestWithStatus
): string | undefined {
  if (request.runtimeStatus === "pending") {
    return `switchboard approve ${request.id} or switchboard deny ${request.id}; then retry ${request.toolName}`;
  }

  if (request.runtimeStatus === "expired") {
    return "retry the original gated tool call to create a fresh approval request";
  }

  if (request.runtimeStatus === "stale") {
    return "retry the original gated tool call to create a fresh approval request";
  }

  return undefined;
}

function formatApprovalDecision(
  path: string,
  request: ApprovalRequestWithStatus
): string {
  return [
    `Updated approval request ${request.id}`,
    `Status: ${request.runtimeStatus}`,
    `Mandate: ${request.mandateId}`,
    ...(request.parentMandateId ? [`Parent: ${request.parentMandateId}`] : []),
    ...(request.delegatedBy ? [`Delegated by: ${request.delegatedBy}`] : []),
    ...(request.delegationPath
      ? [`Delegation path: ${request.delegationPath.join(" -> ")}`]
      : []),
    `Tool: ${request.toolName}`,
    `Gate: ${request.approvalGateId}:${request.approvalGatePattern}`,
    ...(request.approvalGateReason ? [`Reason: ${request.approvalGateReason}`] : []),
    `Store: ${path}`
  ].join("\n");
}

function formatAuditLogs(
  path: string,
  entries: Awaited<ReturnType<typeof readAuditLogEntries>>
): string {
  const lines = ["Switchboard audit logs", `Path: ${path}`];

  if (entries.length === 0) {
    lines.push("", "No audit entries found.");
    return lines.join("\n");
  }

  lines.push("");
  for (const entry of entries) {
    const labelParts = [
      entry.timestamp,
      entry.status,
      entry.action,
      entry.profileName ?? "unknown-profile"
    ];
    if (entry.toolName) {
      labelParts.push(entry.toolName);
    }
    if (entry.mandateId) {
      labelParts.push(`mandate:${entry.mandateId}`);
    }
    if (entry.approvalGateId) {
      labelParts.push(`gate:${entry.approvalGateId}`);
    }
    if (entry.durationMs !== undefined) {
      labelParts.push(`${entry.durationMs}ms`);
    }

    lines.push(labelParts.join(" "));
    if (entry.error) {
      lines.push(`  error: ${entry.error}`);
    }
  }

  return lines.join("\n");
}

function formatInstallSnippet(rendered: {
  client: SupportedClient;
  serverName: string;
  target: string;
  content: string;
}): string {
  return [
    `Switchboard ${rendered.client} config dry run`,
    `Server name: ${rendered.serverName}`,
    `Target: ${rendered.target}`,
    "",
    rendered.content
  ].join("\n");
}

function formatInstallWrite(result: WrittenClientConfig): string {
  return [
    `Installed Switchboard ${result.client} config`,
    `Server name: ${result.serverName}`,
    `Target: ${result.targetPath}`,
    `Action: ${result.action}`,
    `Backup: ${result.backupPath ?? "none"}`
  ].join("\n");
}

function formatInstallRollback(result: RolledBackClientConfig): string {
  return [
    `Rolled back Switchboard ${result.client} config`,
    `Target: ${result.targetPath}`,
    `Restored from: ${result.restoredFrom}`,
    `Current backup: ${result.backupPath ?? "none"}`
  ].join("\n");
}

function optionsFromCwd(cwd: string | undefined): LoadConfigOptions &
  PathResolutionOptions {
  return cwd ? { cwd } : {};
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function installTargetCwd(cwd: string | undefined): string {
  const resolvedCwd = cwd ? resolve(cwd) : process.cwd();
  const repoPaths = resolveRepoConfigPaths(cwd ? { cwd } : {});

  return repoPaths.repoConfigPath ? dirname(repoPaths.repoConfigPath) : resolvedCwd;
}

async function resolveActiveMandateForCommand(options: {
  id: string;
  cwd: string | undefined;
  mandateStorePath: string | undefined;
  writeErr: (message: string) => void;
}): Promise<MandateWithStatus | undefined> {
  const repoPath = installTargetCwd(options.cwd);
  try {
    const mandate = await resolveActiveMandate({
      id: options.id,
      repoPath,
      ...(options.mandateStorePath ? { path: options.mandateStorePath } : {})
    });
    const gitBinding = resolveGitWorktreeBinding(repoPath);
    if (gitBinding && gitBinding.branch !== mandate.branch) {
      throw new Error(
        `mandate "${mandate.id}" is scoped to branch "${mandate.branch}", but current git branch is "${gitBinding.branch}" in ${gitBinding.worktreePath}`
      );
    }

    return mandate;
  } catch (error) {
    options.writeErr(`error: ${messageFromError(error)}`);
    return undefined;
  }
}

function profilesForMandate(
  profiles: ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"],
  mandate: MandateWithStatus
): ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"] {
  const allowedProfiles = new Set(mandate.profiles);
  return Object.fromEntries(
    Object.entries(profiles).filter(([profileName]) =>
      allowedProfiles.has(profileName)
    )
  ) as ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"];
}

async function approvedApprovalRequestsForMandate(
  mandate: MandateWithStatus,
  path: string | undefined
): Promise<Array<{ id: string; approvalGateId: string; toolName: string }>> {
  const requests = await listApprovalRequests({
    ...(path ? { path } : {}),
    repoPath: mandate.repoPath,
    mandateId: mandate.id,
    ...(mandate.mandateUid ? { mandateUid: mandate.mandateUid } : {}),
    status: "approved"
  });

  return requests
    .filter((request) => request.runtimeStatus === "approved")
    .map((request) => ({
      id: request.id,
      approvalGateId: request.approvalGateId,
      toolName: request.toolName
    }));
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

function optionsFromRuntimeDir(
  runtimeDir: string | undefined
): { runtimeDir?: string } {
  return runtimeDir ? { runtimeDir } : {};
}

function parseApprovalWaitDurationForCommand(
  value: string | undefined,
  writeErr: (message: string) => void
): number | undefined {
  if (value === undefined) {
    return 0;
  }

  const trimmed = value.trim();
  if (trimmed === "0") {
    return 0;
  }

  const match = /^([1-9]\d*)(s|m)$/.exec(trimmed);
  if (!match) {
    writeErr("error: --approval-wait must use 0 or a duration like 30s or 2m");
    return undefined;
  }

  const amountText = match[1];
  const unit = match[2];
  if (!amountText || !unit) {
    writeErr("error: --approval-wait must use 0 or a duration like 30s or 2m");
    return undefined;
  }

  const waitMs = Number(amountText) * (unit === "s" ? 1_000 : 60_000);
  if (waitMs > 600_000) {
    writeErr("error: --approval-wait must be 10m or less");
    return undefined;
  }

  return waitMs;
}

function validateLoadedConfigForCommand(
  loaded: ReturnType<typeof loadSwitchboardConfig>,
  writeErr: (message: string) => void
): boolean {
  if (loaded.namespaceCollisions.length > 0) {
    for (const collision of loaded.namespaceCollisions) {
      writeErr(
        `error: namespace "${collision.namespace}" is used by profiles: ${collision.profiles.join(", ")}`
      );
    }
    process.exitCode = 1;
    return false;
  }

  const blockingDiagnostics = loaded.diagnostics.filter(
    (diagnostic) => diagnostic.level === "error"
  );
  if (blockingDiagnostics.length > 0) {
    for (const diagnostic of blockingDiagnostics) {
      writeErr(`error: ${diagnostic.message}`);
    }
    process.exitCode = 1;
    return false;
  }

  return true;
}

function doctorNextSteps(options: {
  ok: boolean;
  loaded: ReturnType<typeof loadSwitchboardConfig>;
  localIgnoreOk: boolean;
  clientConfigs: ProjectClientConfigInspection[];
  cwd: string | undefined;
}): string[] {
  const steps: string[] = [];
  const hasRepoConfig = options.loaded.sources.some(
    (source) => source.kind === "repo" && source.loaded
  );
  const stdioProfiles = stdioProfilesFromConfig(
    options.loaded.config.profiles,
    configCwdBase(options.loaded, options.cwd)
  );
  const placeholderProfiles = stdioProfiles.filter((profile) =>
    (profile.args ?? []).includes(starterUpstreamArgPlaceholder)
  );

  if (!hasRepoConfig) {
    steps.push("switchboard init --write");
  }

  if (!options.localIgnoreOk) {
    steps.push('add ".switchboard.local.yaml" to .gitignore');
  }

  if (options.loaded.namespaceCollisions.length > 0) {
    steps.push("rename profiles or set explicit namespaces to resolve collisions");
  }

  if (options.loaded.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
    steps.push("fix config diagnostics above, then rerun switchboard doctor");
  }

  for (const config of options.clientConfigs) {
    if (config.status === "invalid") {
      steps.push(`fix ${config.targetPath}, then rerun switchboard doctor`);
    }
  }

  if (placeholderProfiles.length > 0) {
    steps.push("edit .switchboard.yaml and replace the starter upstream args");
  }

  const readyProfile = stdioProfiles.find(
    (profile) => !placeholderProfiles.includes(profile)
  );
  if (options.ok && readyProfile) {
    steps.push(`switchboard test ${readyProfile.profileName}`);
    for (const config of options.clientConfigs) {
      if (config.status === "missing" || config.status === "stale") {
        steps.push(`switchboard install ${config.client} --write`);
      }
    }
  } else if (options.ok && placeholderProfiles.length === 0) {
    steps.push("add a stdio upstream profile, then run switchboard test <profile>");
  }

  return [...new Set(steps)];
}

function parseTimeoutMs(value: string): number | undefined {
  return parsePositiveInteger(value);
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseHandoffState(
  value: string
): "completed" | "blocked" | "cancelled" | undefined {
  if (value === "completed" || value === "blocked" || value === "cancelled") {
    return value;
  }

  return undefined;
}

function parseSupportedClient(value: string): SupportedClient | undefined {
  if (value === "codex" || value === "claude") {
    return value;
  }

  return undefined;
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

async function serveProfilesOverStdio(
  profiles: StdioUpstreamProfile[],
  options: {
    auditLogger?: AuditLogger;
    mandateId?: string;
    auditContext?: {
      mandateUid?: string;
      repoPath?: string;
      worktreePath?: string;
      branch?: string;
    };
    toolPolicy?: MandateToolPolicy;
  } = {}
): Promise<void> {
  const router = new GenericMcpRouter(
    profiles,
    {
      ...(options.auditLogger ? { auditLogger: options.auditLogger } : {}),
      ...(options.mandateId ? { mandateId: options.mandateId } : {}),
      ...(options.auditContext ? { auditContext: options.auditContext } : {}),
      ...(options.toolPolicy ? { toolPolicy: options.toolPolicy } : {})
    }
  );
  await serveSwitchboardMcpStdio(router);
}

async function listToolsOverProfiles(
  profiles: StdioUpstreamProfile[],
  options: {
    auditLogger?: AuditLogger;
    mandateId?: string;
    auditContext?: {
      mandateUid?: string;
      repoPath?: string;
      worktreePath?: string;
      branch?: string;
    };
    toolPolicy?: MandateToolPolicy;
  } = {}
): Promise<NamespacedTool[]> {
  const router = new GenericMcpRouter(
    profiles,
    {
      ...(options.auditLogger ? { auditLogger: options.auditLogger } : {}),
      ...(options.mandateId ? { mandateId: options.mandateId } : {}),
      ...(options.auditContext ? { auditContext: options.auditContext } : {}),
      ...(options.toolPolicy ? { toolPolicy: options.toolPolicy } : {})
    }
  );

  try {
    return await router.discoverTools();
  } finally {
    await router.close().catch(() => undefined);
  }
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
