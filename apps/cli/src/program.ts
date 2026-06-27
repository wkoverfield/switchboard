import { Command } from "commander";
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AuditLogEntry,
  type AuditLogger,
  type ApprovalRequestWithStatus,
  checkLocalConfigIgnored,
  checkInstalledClientLaunches,
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
  renewMandate,
  renderSwitchboardClientConfig,
  resolveApprovalRequestStorePath,
  resolveAuditLogPath,
  resolveActiveMandate,
  resolveMandateStorePath,
  rollbackSwitchboardClientConfig,
  safeAuditLog,
  collectSecretRefUsages,
  checkProviderSafetyTemplateTools,
  createSwitchboardImportPlan,
  createProviderAddPlan,
  createKeychainSecretStore,
  getProviderSafetyTemplate,
  providerSafetyTemplatePolicy,
  type PathResolutionOptions,
  findMissingSecretRefs,
  forgetSecretRef,
  listProviderSafetyTemplates,
  listSecretRefs,
  rememberSecretRef,
  renderProviderSafetyTemplate,
  resolveSecretIndexPath,
  resolveGlobalConfigPath,
  resolveRepoConfigPaths,
  scanSwitchboardProject,
  type SwitchboardScanResult,
  type SwitchboardImportPlan,
  type WrittenSwitchboardImportPlan,
  type BypassFinding,
  planRecommendedNextAction,
  type NextActionCandidate,
  type RecommendedNextAction,
  type RenderedProviderSafetyTemplate,
  type ProviderAddPlan,
  type WrittenProviderAddPlan,
  starterUpstreamArgPlaceholder,
  type MissingSecretRef,
  type SupportedClient,
  type SwitchboardConfig,
  type ClientLaunchCheck,
  type SecretStore,
  updateMandateHandoff,
  validateSecretRef,
  validateInitConfigOptions,
  validateSwitchboardClientConfigOptions,
  type ProjectClientConfigInspection,
  writeSwitchboardClientConfig,
  writeSwitchboardImportPlan,
  writeProviderAddPlan,
  type RolledBackClientConfig,
  type WrittenClientConfig
} from "@switchboard-mcp/core";
import {
  GenericMcpRouter,
  listDaemonTools,
  pingDaemon,
  profileConfigToStdioUpstream,
  profileConfigToStdioUpstreamWithSecrets,
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

const version = "0.1.1";
const mandateMcpLaunchSchemaVersion = "switchboard.mcp-launch.v1";
const workspaceLeaseSchemaVersion = "switchboard.workspace-lease.v1";
const mandateStatusSchemaVersion = "switchboard.mandate-status.v1";
const mandateReportSchemaVersion = "switchboard.mandate-report.v1";
const mandateEscalationSchemaVersion = "switchboard.mandate-escalation.v1";
const approvalRequestsSchemaVersion = "switchboard.approvals.v1";
const toolSurfaceSchemaVersion = "switchboard.tool-surface.v1";
const auditLogSchemaVersion = "switchboard.audit-log.v1";
const secretsSchemaVersion = "switchboard.secrets.v1";
const providerPresetSchemaVersion = "switchboard.provider-preset.v1";
const providerPresetCheckSchemaVersion = "switchboard.provider-preset-check.v1";
const providerAddSchemaVersion = "switchboard.provider-add.v1";
const errorSchemaVersion = "switchboard.error.v1";

interface CommandErrorEnvelope {
  ok: false;
  schemaVersion: typeof errorSchemaVersion;
  code: string;
  message: string;
  nextActions: string[];
}

interface CommandErrorOptions {
  json: boolean | undefined;
  code: string;
  message: string;
  nextActions?: string[];
}

interface MandateMcpLaunchPayload {
  schemaVersion: typeof mandateMcpLaunchSchemaVersion;
  transport: "stdio";
  mandateId: string;
  cwd: string;
  runtimeDir: string | null;
  env: Record<string, string>;
  approvalWaitMs: number;
  daemonIsolation: "repo-runtime-dir" | "default";
  command: "switchboard";
  args: string[];
  commandCandidates: MandateMcpLaunchCommandCandidate[];
  commands: MandateMcpLaunchCommands;
  policy: MandateMcpLaunchPolicy;
  installHint: string;
}

interface MandateMcpLaunchCommand {
  command: "switchboard";
  args: string[];
}

interface MandateMcpLaunchCommands {
  mcp: MandateMcpLaunchCommand;
  toolSurface: MandateMcpLaunchCommand;
  approvals: MandateMcpLaunchCommand;
  status: MandateMcpLaunchCommand;
  report: MandateMcpLaunchCommand;
  logs: MandateMcpLaunchCommand;
  escalation: MandateMcpLaunchCommand;
  childTemplate: MandateMcpLaunchCommand;
}

interface MandateMcpLaunchPolicy {
  profiles: string[];
  allowedTools: string[];
  deniedTools: string[];
  approvalGates: Array<{
    id: string;
    toolPattern: string;
    reason?: string;
    risk?: string;
    labels?: string[];
  }>;
}

interface WorkspaceLeasePayload {
  schemaVersion: typeof workspaceLeaseSchemaVersion;
  mandateId: string;
  mandateUid: string | null;
  repo: {
    path: string;
    worktreePath: string;
    branch: string;
  };
  runtime: {
    kind: "local";
    transport: "stdio";
  };
  envClass: "non-prod" | "prod" | "unknown";
  authority: {
    agentRole: string;
    profiles: string[];
    allowedTools: string[];
    deniedTools: string[];
    approvalGates: MandateMcpLaunchPolicy["approvalGates"];
    parentMandateId?: string;
    parentMandateUid?: string;
  };
  lease: {
    createdAt: string;
    expiresAt: string;
    status: MandateWithStatus["runtimeStatus"];
  };
  mcpLaunch: MandateMcpLaunchPayload;
  runLaunch: WorkspaceLeaseRunLaunch;
  capabilities: WorkspaceLeaseCapabilities;
  commands: MandateMcpLaunchCommands;
  limits: string[];
}

interface WorkspaceLeaseRunLaunch {
  schemaVersion: "switchboard.run-launch.v1";
  command: "switchboard";
  args: string[];
  env: Record<string, string>;
  note: string;
}

interface WorkspaceLeaseCapabilities {
  mcpLaunchEnv: true;
  runLaunch: true;
  structuredMcpErrors: true;
  daemonRuntimeDir: boolean;
}

interface MandateMcpLaunchCommandCandidate {
  kind: "path" | "current-entrypoint" | "source-entrypoint";
  command: string;
  args: string[];
  description: string;
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
  readiness: MandateReportReadiness;
  results: MandateReportResults;
  childrenByParent: Record<string, string[]>;
  mandates: MandateWithStatus[];
  approvalRequests: ApprovalRequestWithStatus[];
  auditEntries: AuditLogEntry[];
}

interface MandateReportReadiness {
  selectedCanHandoff: boolean;
  selectedHandoffState: MandateWithStatus["handoffState"];
  openChildMandates: Array<{
    id: string;
    mandateUid: string | null;
    agentRole: string;
    branch: string;
  }>;
  pendingApprovalRequests: Array<{
    id: string;
    mandateId: string;
    mandateUid: string | null;
    toolName: string;
    approvalGateId: string;
  }>;
  missingSecretRefs: Array<{
    ref: string;
    profiles: string[];
    envNames: string[];
    status: MissingSecretRef["status"];
    message: string;
  }>;
  blockers: string[];
  nextActions: string[];
}

interface MandateStatusReadiness {
  blockers: string[];
  warnings: string[];
  nextActions: string[];
  mandates: Record<
    string,
    {
      blockers: string[];
      warnings: string[];
      nextActions: string[];
    }
  >;
}

interface MandateReportResults {
  counts: {
    handoffs: number;
    completed: number;
    blocked: number;
    cancelled: number;
    open: number;
    summaries: number;
    nextSteps: number;
    artifacts: number;
  };
  handoffs: Array<{
    id: string;
    mandateUid: string | null;
    parentMandateId: string | null;
    state: Exclude<MandateWithStatus["handoffState"], "open">;
    agentRole: string;
    branch: string;
    summary: string | null;
    nextSteps: string[];
    artifacts: string[];
    by: string | null;
    at: string | null;
  }>;
  openMandates: Array<{
    id: string;
    mandateUid: string | null;
    agentRole: string;
    branch: string;
  }>;
  nextSteps: Array<{
    mandateId: string;
    mandateUid: string | null;
    value: string;
  }>;
  artifacts: Array<{
    mandateId: string;
    mandateUid: string | null;
    value: string;
  }>;
}

interface MandateEscalationPayload {
  schemaVersion: typeof mandateEscalationSchemaVersion;
  reportSchemaVersion: typeof mandateReportSchemaVersion;
  path: string;
  auditLogPath: string;
  repoPath: string | null;
  selectedMandateId: string;
  selectedMandateUid: string | null;
  rootMandateId: string;
  rootMandateUid: string | null;
  generatedAt: string;
  status: "clear" | "needs_attention";
  counts: {
    items: number;
    approvalRequests: number;
    openChildMandates: number;
    missingSecretRefs: number;
    blockedHandoffs: number;
    cancelledHandoffs: number;
  };
  nextCommands: string[];
  copyText: string;
  items: MandateEscalationItem[];
}

interface MandateEscalationItem {
  type:
    | "approval_request"
    | "open_child_mandate"
    | "missing_secret_ref"
    | "blocked_handoff"
    | "cancelled_handoff";
  priority: "decision" | "handoff" | "setup" | "review";
  mandateId: string;
  mandateUid: string | null;
  title: string;
  detail: string;
  commands: string[];
  approvalRequestId?: string;
  toolName?: string;
  approvalGateId?: string;
  state?: Exclude<MandateWithStatus["handoffState"], "open">;
  summary?: string | null;
  nextSteps?: string[];
  artifacts?: string[];
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

interface AuditLogPayload {
  ok: true;
  schemaVersion: typeof auditLogSchemaVersion;
  path: string;
  mandateId: string | null;
  filters: {
    mandateId: string | null;
    limit: number;
  };
  counts: {
    totalMatching: number;
    returned: number;
  };
  entries: AuditLogEntry[];
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
  secretStore?: SecretStore;
  secretIndexPath?: string;
  readSecretFromStdin?: () => Promise<string>;
  readSecretFromPrompt?: (prompt: string) => Promise<string>;
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
  const secretStore = io.secretStore ?? createKeychainSecretStore();
  const readSecretFromStdin = io.readSecretFromStdin ?? readAllStdin;
  const readSecretFromPrompt = io.readSecretFromPrompt ?? readHiddenPrompt;
  const program = new Command();
  let currentParseArgs: string[] = [];
  const writeCommandError = (options: CommandErrorOptions): void => {
    if (options.json) {
      writeOut(JSON.stringify(commandErrorEnvelope(options), null, 2));
    } else {
      writeErr(`error: ${options.message}`);
    }
    process.exitCode = 1;
  };
  const originalParseAsync = program.parseAsync.bind(program);
  program.parseAsync = async (...args: Parameters<Command["parseAsync"]>) => {
    currentParseArgs = userArgsFromParseInput(args[0], args[1]);
    return originalParseAsync(...args);
  };
  const validateLoadedConfigForJsonCommand = (
    loaded: ReturnType<typeof loadSwitchboardConfig>,
    json: boolean | undefined
  ): boolean => {
    if (!json) {
      return validateLoadedConfigForCommand(loaded, writeErr);
    }

    const configError = loadedConfigCommandError(loaded);
    if (!configError) {
      return true;
    }

    writeCommandError({
      json,
      code: configError.code,
      message: configError.message,
      nextActions: configError.nextActions
    });
    return false;
  };
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
    .command("scan")
    .description("Inspect this repo and suggest production-safe agent setup.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const launch = resolveInstallLaunch({ commandArgs: [] });
      const result = await scanSwitchboardProject({
        ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
        command: launch.command,
        commandArgs: launch.commandArgs
      });
      const displayResult = rewriteScanCommandsForCurrentInvocation(result);

      writeOut(
        options.json
          ? JSON.stringify(displayResult, null, 2)
          : formatScan(displayResult)
      );
    });

  program
    .command("run")
    .description("Run an allowed provider command with mandate-scoped credentials and audit.")
    .requiredOption("--mandate <id>", "active mandate id")
    .option("--json", "print machine-readable JSON")
    .allowUnknownOption(false)
    .argument("<command>", "provider command to run")
    .argument("[args...]", "command arguments")
    .action(
      async (
        command: string,
        args: string[],
        options: { mandate: string; json?: boolean }
      ) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const cwd = resolve(globalOptions.cwd ?? process.cwd());
        const loaded = loadSwitchboardConfig(optionsFromCwd(cwd));
        const mandateStorePath = io.mandateStorePath ?? resolveMandateStorePath();
        const startedAt = Date.now();

        try {
          const mandate = await resolveActiveMandate({
            id: options.mandate,
            repoPath: cwd,
            path: mandateStorePath
          });
          const readiness = await validateRunReadiness({
            cwd,
            command,
            args,
            mandate,
            config: loaded.config,
            secretStore
          });

          if (!readiness.ok) {
            await safeAuditLog(auditLogger, {
              action: "command_run",
              status: "error",
              mandateId: mandate.id,
              ...(mandate.mandateUid ? { mandateUid: mandate.mandateUid } : {}),
              repoPath: mandate.repoPath,
              worktreePath: mandate.worktreePath,
              branch: mandate.branch,
              command,
              args,
              cwd,
              envKeys: readiness.envKeys,
              durationMs: Date.now() - startedAt,
              error: readiness.message
            });
            writeCommandError({
              json: options.json,
              code: readiness.code,
              message: readiness.message,
              nextActions: readiness.nextActions
            });
            process.exitCode = 1;
            return;
          }

          const result = spawnSync(readiness.commandPath, args, {
            cwd,
            env: readiness.env,
            encoding: "utf8",
            maxBuffer: 1024 * 1024
          });
          const status = result.status === 0 ? "ok" : "error";
          const stdout = result.stdout ?? "";
          const stderr = result.stderr ?? "";
          await safeAuditLog(auditLogger, {
            action: "command_run",
            status,
            mandateId: mandate.id,
            ...(mandate.mandateUid ? { mandateUid: mandate.mandateUid } : {}),
            repoPath: mandate.repoPath,
            worktreePath: mandate.worktreePath,
            branch: mandate.branch,
            command,
            args,
            cwd,
            envKeys: Object.keys(readiness.env).sort(),
            exitCode: result.status,
            durationMs: Date.now() - startedAt,
            stdoutSnippet: snippet(stdout),
            stderrSnippet: snippet(stderr),
            ...(result.error ? { error: messageFromError(result.error) } : {})
          });

          if (options.json) {
            writeOut(
              JSON.stringify(
                {
                  ok: status === "ok",
                  schemaVersion: "switchboard.run.v1",
                  mandateId: mandate.id,
                  command,
                  args,
                  cwd,
                  envKeys: Object.keys(readiness.env).sort(),
                  exitCode: result.status,
                  durationMs: Date.now() - startedAt,
                  stdout: redactCommandOutput(stdout),
                  stderr: redactCommandOutput(stderr),
                  note:
                    "switchboard run scopes credentials and audits execution; it is not a filesystem or network sandbox."
                },
                null,
                2
              )
            );
          } else {
            if (stdout) {
              writeOut(redactCommandOutput(stdout).trimEnd());
            }
            if (stderr) {
              writeErr(redactCommandOutput(stderr).trimEnd());
            }
          }

          if (status !== "ok") {
            process.exitCode = result.status ?? 1;
          }
        } catch (error) {
          const message = messageFromError(error);
          await safeAuditLog(auditLogger, {
            action: "command_run",
            status: "error",
            mandateId: normalizeMandateId(options.mandate),
            repoPath: cwd,
            worktreePath: cwd,
            branch: currentGitBranch(cwd) ?? "unknown",
            command,
            args,
            cwd,
            durationMs: Date.now() - startedAt,
            error: message
          });
          writeCommandError({
            json: options.json,
            code: runErrorCode(message),
            message,
            nextActions: runErrorNextActions(message, options.mandate)
          });
          process.exitCode = 1;
        }
      }
    );

  program
    .command("import")
    .description("Plan a cleanup of existing project MCP config into Switchboard.")
    .option("--dry-run", "print the import plan without writing")
    .option("--write", "apply the import plan")
    .option("--cleanup-client", "remove direct MCP bypass routes from active project client config with backups")
    .option("--json", "print machine-readable JSON")
    .action(
      async (options: { dryRun?: boolean; write?: boolean; cleanupClient?: boolean; json?: boolean }) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        if (options.write) {
          try {
            const result = await writeSwitchboardImportPlan({
              ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
              ...(options.cleanupClient ? { cleanupClient: true } : {})
            });
            const displayResult = rewriteWrittenImportCommandsForCurrentInvocation(result);
            writeOut(
              options.json
                ? JSON.stringify(formatImportWriteJson(displayResult), null, 2)
                : formatImportWrite(displayResult)
            );
          } catch (error) {
            writeCommandError({
              json: options.json,
              code: "import_write_failed",
              message: messageFromError(error),
              nextActions: [
                "Run switchboard import --dry-run to inspect the cleanup plan before writing.",
                "Resolve profile or namespace collisions, then retry switchboard import --write."
              ]
            });
          }
          return;
        }

        const plan = await createSwitchboardImportPlan({
          ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {})
        });
        const displayPlan = rewriteImportCommandsForCurrentInvocation(plan);
        writeOut(
          options.json
            ? JSON.stringify(displayPlan, null, 2)
            : formatImportPlan(displayPlan)
        );
      }
    );

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
      const result = await createDoctorResult({
        cwd: globalOptions.cwd,
        secretStore
      });

      if (options.json) {
        writeOut(JSON.stringify(result, null, 2));
      } else {
        writeOut(formatDoctor(result));
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  program
    .command("next")
    .description("Print the single recommended next Switchboard action for this repo.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const result = await createNextActionResult({
        cwd: globalOptions.cwd,
        secretStore
      });
      const payload = {
        ok: result.primary !== null,
        schemaVersion: "switchboard.next-action.v1",
        recommendedNextAction: result,
        nextSteps: [
          ...(result.primary ? [result.primary.command] : []),
          ...result.alternatives.map((item) => item.command)
        ]
      };

      if (options.json) {
        writeOut(JSON.stringify(payload, null, 2));
        return;
      }

      writeOut(formatNextAction(payload.recommendedNextAction));
    });

  const secrets = program
    .command("secrets")
    .description("Manage local Switchboard secret references.");

  secrets
    .command("set <ref>")
    .description("Store or update a local secret value by secretRef.")
    .option("--value-stdin", "read the secret value from stdin")
    .option("--json", "print machine-readable JSON")
    .action(
      async (ref: string, options: { valueStdin?: boolean; json?: boolean }) => {
        const validation = validateSecretRef(ref);
        if (!validation.ok) {
          writeCommandError({
            json: options.json,
            code: "invalid_secret_ref",
            message: validation.errors.join("; "),
            nextActions: [
              "Use a lowercase path-like ref such as github/findu/dev/token."
            ]
          });
          return;
        }
        if (!options.valueStdin) {
          writeCommandError({
            json: options.json,
            code: "missing_secret_input",
            message: "--value-stdin is required for this non-interactive V0",
            nextActions: [
              `Pipe a secret value on stdin, for example: pbpaste | switchboard secrets set ${ref} --value-stdin`
            ]
          });
          return;
        }

        try {
          const value = await readSecretFromStdin();
          if (value.length === 0) {
            writeCommandError({
              json: options.json,
              code: "empty_secret",
              message: "secret value must not be empty",
              nextActions: ["Pipe a non-empty secret value on stdin."]
            });
            return;
          }
          await secretStore.set(ref, value);
          await rememberSecretRef(ref, secretIndexOptions(io.secretIndexPath));
          const result = {
            ok: true,
            schemaVersion: secretsSchemaVersion,
            action: "set",
            ref,
            indexPath: resolveSecretIndexPath(
              secretIndexOptions(io.secretIndexPath)
            )
          };
          writeOut(options.json ? JSON.stringify(result, null, 2) : `Stored secretRef ${ref}`);
        } catch (error) {
          writeCommandError({
            json: options.json,
            code: "secret_set_failed",
            message: messageFromError(error)
          });
        }
      }
    );

  secrets
    .command("list")
    .description("List local Switchboard secret references without values.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const indexPath = resolveSecretIndexPath(
        secretIndexOptions(io.secretIndexPath)
      );
      const refs = await listSecretRefs(secretIndexOptions(io.secretIndexPath));
      const result = {
        ok: true,
        schemaVersion: secretsSchemaVersion,
        indexPath,
        count: refs.length,
        refs
      };
      writeOut(options.json ? JSON.stringify(result, null, 2) : formatSecretsList(result));
    });

  secrets
    .command("remove <ref>")
    .alias("rm")
    .description("Remove a local secret value and forget its ref.")
    .option("--json", "print machine-readable JSON")
    .action(async (ref: string, options: { json?: boolean }) => {
      const validation = validateSecretRef(ref);
      if (!validation.ok) {
        writeCommandError({
          json: options.json,
          code: "invalid_secret_ref",
          message: validation.errors.join("; "),
          nextActions: [
            "Use a lowercase path-like ref such as github/findu/dev/token."
          ]
        });
        return;
      }
      try {
        await secretStore.delete(ref);
        await forgetSecretRef(ref, secretIndexOptions(io.secretIndexPath));
        const result = {
          ok: true,
          schemaVersion: secretsSchemaVersion,
          action: "remove",
          ref,
          indexPath: resolveSecretIndexPath(
            secretIndexOptions(io.secretIndexPath)
          )
        };
        writeOut(
          options.json
            ? JSON.stringify(result, null, 2)
            : `Removed secretRef ${ref}`
        );
      } catch (error) {
        writeCommandError({
          json: options.json,
          code: "secret_remove_failed",
          message: messageFromError(error)
        });
      }
    });

  secrets
    .command("doctor")
    .description("Check configured secretRefs without printing values.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
      const missingSecrets = await findMissingSecretRefs(
        loaded.config,
        secretStore
      );
      const backend = await diagnoseSecretStore(secretStore);
      const result = {
        ok:
          isSecretBackendDiagnosticOk(backend) &&
          missingSecrets.length === 0 &&
          !loaded.diagnostics.some((item) => item.level === "error"),
        schemaVersion: secretsSchemaVersion,
        indexPath: resolveSecretIndexPath(
          secretIndexOptions(io.secretIndexPath)
        ),
        backend,
        diagnostics: loaded.diagnostics,
        usages: collectSecretRefUsages(loaded.config),
        missing: missingSecrets
      };
      writeOut(
        options.json
          ? JSON.stringify(result, null, 2)
          : formatSecretsDoctor(result)
      );
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  program
    .command("auth <preset>")
    .description("Store the recommended local token for a provider preset.")
    .option("--secret-ref <ref>", "override the preset secretRef")
    .option(
      "--value-stdin",
      "read the token from stdin without printing an interactive prompt"
    )
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        preset: string,
        options: { secretRef?: string; valueStdin?: boolean; json?: boolean }
      ) => {
        const template = getProviderSafetyTemplate(preset);
        if (!template) {
          writeCommandError({
            json: options.json,
            code: "unknown_provider_preset",
            message: `unknown provider safety template "${preset}"`,
            nextActions: [
              "Run switchboard presets list to see available templates."
            ]
          });
          return;
        }

        const cwd = resolve(program.opts<{ cwd?: string }>().cwd ?? process.cwd());
        const defaults = repoAwarePresetDefaults(preset, cwd);
        const resolvedSecretRef = options.secretRef ?? defaults.secretRef;
        const validation = validateSecretRef(resolvedSecretRef);
        if (!validation.ok) {
          writeCommandError({
            json: options.json,
            code: "invalid_secret_ref",
            message: validation.errors.join("; "),
            nextActions: [
              "Use a lowercase path-like ref such as github/findu/dev/token."
            ]
          });
          return;
        }

        try {
          const value = options.valueStdin
            ? await readSecretFromStdin()
            : await readSecretFromPrompt(
                `Paste ${template.label} token for ${template.secretEnvName}: `
              );
          if (value.length === 0) {
            writeCommandError({
              json: options.json,
              code: "empty_secret",
              message: "token value must not be empty",
              nextActions: [
                `Run ${formatHumanCommand(`switchboard auth ${preset}`)} again and paste a non-empty token.`
              ]
            });
            return;
          }

          await secretStore.set(resolvedSecretRef, value);
          await rememberSecretRef(resolvedSecretRef, secretIndexOptions(io.secretIndexPath));
          const result = {
            ok: true,
            schemaVersion: secretsSchemaVersion,
            action: "auth",
            presetId: template.id,
            provider: template.provider,
            label: template.label,
            secretEnvName: template.secretEnvName,
            ref: resolvedSecretRef,
            indexPath: resolveSecretIndexPath(
              secretIndexOptions(io.secretIndexPath)
            ),
            nextSteps: [
              `switchboard doctor`,
              `switchboard presets check ${template.id} --profile ${defaults.profileName}`,
              `switchboard mandate create --from ${template.id}`
            ].map((step) =>
              rewriteSwitchboardCommand(step, switchboardCommandPrefixForRepo(cwd))
            )
          };
          writeOut(
            options.json
              ? JSON.stringify(result, null, 2)
              : formatProviderAuth(result)
          );
        } catch (error) {
          const message = messageFromError(error);
          writeCommandError({
            json: options.json,
            code: "provider_auth_failed",
            message,
            ...(message.includes("--value-stdin")
              ? {
                  nextActions: [
                    `Pipe the token with: pbpaste | ${formatHumanCommand(`switchboard auth ${preset} --value-stdin`)}`
                  ]
                }
              : {})
          });
        }
      }
    );

  program
    .command("add <preset>")
    .description("Plan or write a guided provider setup from a safety template.")
    .option("--json", "print machine-readable JSON")
    .option("--dry-run", "print the setup plan without writing")
    .option("--write", "write or update .switchboard.yaml")
    .option("--profile-name <name>", "profile name to render")
    .option("--namespace <name>", "namespace to render")
    .option("--secret-ref <ref>", "secretRef to render")
    .option("--command <command>", "upstream MCP server command to render")
    .option(
      "--arg <arg>",
      "upstream MCP server arg to render (repeatable)",
      collectOption,
      [] as string[]
    )
    .action(
      async (
        preset: string,
        options: {
          json?: boolean;
          dryRun?: boolean;
          write?: boolean;
          profileName?: string;
          namespace?: string;
          secretRef?: string;
          command?: string;
          arg: string[];
        }
      ) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        if (!getProviderSafetyTemplate(preset)) {
          writeCommandError({
            json: options.json,
            code: "unknown_provider_preset",
            message: `unknown provider safety template "${preset}"`,
            nextActions: [
              "Run switchboard presets list to see available templates."
            ]
          });
          return;
        }
        if (options.dryRun && options.write) {
          writeCommandError({
            json: options.json,
            code: "conflicting_provider_add_modes",
            message: "use either --dry-run or --write, not both",
            nextActions: [
              "Run switchboard add without --write to preview the setup plan.",
              "Run switchboard add --write when you are ready to update .switchboard.yaml."
            ]
          });
          return;
        }

        const cwd = resolve(globalOptions.cwd ?? process.cwd());
        const branch = currentGitBranch(cwd);
        const defaults = repoAwarePresetDefaults(preset, cwd);
        const planOptions = {
          id: preset,
          ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
          ...(branch ? { mandateBranch: branch } : {}),
          profileName: options.profileName ?? defaults.profileName,
          namespace: options.namespace ?? defaults.namespace,
          secretRef: options.secretRef ?? defaults.secretRef,
          ...(options.command ? { command: options.command } : {}),
          ...(options.arg.length > 0 ? { args: options.arg } : {})
        };

        try {
          if (options.write) {
            const result = await writeProviderAddPlan(planOptions);
            writeOut(
              options.json
                ? JSON.stringify(formatProviderAddWriteJson(result), null, 2)
                : formatProviderAddWrite(result)
            );
            return;
          }

          const plan = await createProviderAddPlan(planOptions);
          writeOut(
            options.json
              ? JSON.stringify(formatProviderAddPlanJson(plan), null, 2)
              : formatProviderAddPlan(plan)
          );
        } catch (error) {
          writeCommandError({
            json: options.json,
            code: "provider_add_failed",
            message: messageFromError(error),
            nextActions: [
              "Run switchboard presets show to inspect the template before writing."
            ]
          });
        }
      }
    );

  program
    .command("setup <preset>")
    .description("Guided provider setup: write config and store the provider token.")
    .option("--json", "print machine-readable JSON; requires --value-stdin")
    .option("--profile-name <name>", "profile name to render")
    .option("--namespace <name>", "namespace to render")
    .option("--secret-ref <ref>", "secretRef to render")
    .option("--command <command>", "upstream MCP server command to render")
    .option(
      "--arg <arg>",
      "upstream MCP server arg to render (repeatable)",
      collectOption,
      [] as string[]
    )
    .option(
      "--value-stdin",
      "read the token from stdin instead of prompting"
    )
    .action(
      async (
        preset: string,
        options: {
          json?: boolean;
          profileName?: string;
          namespace?: string;
          secretRef?: string;
          command?: string;
          arg: string[];
          valueStdin?: boolean;
        }
      ) => {
        const template = getProviderSafetyTemplate(preset);
        if (!template) {
          writeCommandError({
            json: options.json,
            code: "unknown_provider_preset",
            message: `unknown provider safety template "${preset}"`,
            nextActions: [
              "Run switchboard presets list to see available templates."
            ]
          });
          return;
        }

        if (options.json && !options.valueStdin) {
          writeCommandError({
            json: options.json,
            code: "missing_secret_input",
            message: "--json setup requires --value-stdin",
            nextActions: [
              `Pipe the token with: pbpaste | ${formatHumanCommand(rewriteSwitchboardCommand(`switchboard setup ${preset} --value-stdin --json`, switchboardCommandPrefixForRepo(resolve(program.opts<{ cwd?: string }>().cwd ?? process.cwd()))))}`
            ]
          });
          return;
        }

        const cwd = resolve(program.opts<{ cwd?: string }>().cwd ?? process.cwd());
        const branch = currentGitBranch(cwd);
        const defaults = repoAwarePresetDefaults(preset, cwd);
        const planOptions = {
          id: preset,
          ...(program.opts<{ cwd?: string }>().cwd
            ? { cwd: program.opts<{ cwd?: string }>().cwd }
            : {}),
          ...(branch ? { mandateBranch: branch } : {}),
          profileName: options.profileName ?? defaults.profileName,
          namespace: options.namespace ?? defaults.namespace,
          secretRef: options.secretRef ?? defaults.secretRef,
          ...(options.command ? { command: options.command } : {}),
          ...(options.arg.length > 0 ? { args: options.arg } : {})
        };

        try {
          const written = await writeProviderAddPlan(planOptions);
          const value = options.valueStdin
            ? await readSecretFromStdin()
            : await readSecretFromPrompt(
                `Paste ${template.label} token for ${template.secretEnvName}: `
              );
          if (value.length === 0) {
            writeCommandError({
              json: options.json,
              code: "empty_secret",
              message: "token value must not be empty",
              nextActions: [
                `Run ${formatHumanCommand(`switchboard setup ${preset}`)} again and paste a non-empty token.`
              ]
            });
            return;
          }

          await secretStore.set(written.plan.rendered.secretRef, value);
          await rememberSecretRef(
            written.plan.rendered.secretRef,
            secretIndexOptions(io.secretIndexPath)
          );
          const result = {
            ok: true,
            schemaVersion: providerAddSchemaVersion,
            action: "setup",
            presetId: written.plan.id,
            provider: template.provider,
            label: template.label,
            targetPath: written.plan.targetPath,
            configAction: written.action,
            backupPath: written.backupPath,
            profileName: written.plan.rendered.profileName,
            namespace: written.plan.rendered.namespace,
            secretRef: written.plan.rendered.secretRef,
            tokenStored: true,
            nextSteps: providerSetupNextSteps(written.plan).map((step) =>
              rewriteSwitchboardCommand(step, switchboardCommandPrefixForRepo(cwd))
            )
          };
          writeOut(
            options.json
              ? JSON.stringify(result, null, 2)
              : formatProviderSetup(result)
          );
        } catch (error) {
          const message = messageFromError(error);
          writeCommandError({
            json: options.json,
            code: "provider_setup_failed",
            message,
            ...(message.includes("--value-stdin")
              ? {
                nextActions: [
                    `Pipe the token with: pbpaste | ${formatHumanCommand(rewriteSwitchboardCommand(`switchboard setup ${preset} --value-stdin`, switchboardCommandPrefixForRepo(cwd)))}`
                  ]
                }
              : {})
          });
        }
      }
    );

  const presets = program
    .command("presets")
    .description("Inspect provider safety templates without installing providers.");

  presets
    .command("list")
    .description("List built-in provider safety templates.")
    .option("--json", "print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const templates = listProviderSafetyTemplates();
      const result = {
        ok: true,
        schemaVersion: providerPresetSchemaVersion,
        count: templates.length,
        templates: templates.map((template) => ({
          id: template.id,
          provider: template.provider,
          label: template.label,
          description: template.description,
          defaultProfileName: template.defaultProfileName,
          defaultNamespace: template.defaultNamespace,
          defaultSecretRef: template.defaultSecretRef,
          mode: template.mode,
          readOnly: template.readOnly
        }))
      };

      writeOut(
        options.json
          ? JSON.stringify(result, null, 2)
          : formatProviderPresetList(result)
      );
    });

  presets
    .command("show <id>")
    .description("Show a provider safety template as value-free config YAML.")
    .option("--profile-name <name>", "profile name to render")
    .option("--namespace <name>", "namespace to render")
    .option("--secret-ref <ref>", "secretRef to render")
    .option("--command <command>", "upstream MCP server command to render")
    .option(
      "--arg <arg>",
      "upstream MCP server arg to render (repeatable)",
      collectOption,
      [] as string[]
    )
    .option("--json", "print machine-readable JSON")
    .action(
      (
        id: string,
        options: {
          profileName?: string;
          namespace?: string;
          secretRef?: string;
          command?: string;
          arg: string[];
          json?: boolean;
        }
      ) => {
        const template = getProviderSafetyTemplate(id);
        if (!template) {
          writeCommandError({
            json: options.json,
            code: "unknown_provider_preset",
            message: `unknown provider safety template "${id}"`,
            nextActions: [
              "Run switchboard presets list to see available templates."
            ]
          });
          return;
        }

        try {
          const rendered = renderProviderSafetyTemplate(id, {
            ...(options.profileName ? { profileName: options.profileName } : {}),
            ...(options.namespace ? { namespace: options.namespace } : {}),
            ...(options.secretRef ? { secretRef: options.secretRef } : {}),
            ...(options.command ? { command: options.command } : {}),
            ...(options.arg.length > 0 ? { args: options.arg } : {})
          });
          const result = {
            ok: true,
            schemaVersion: providerPresetSchemaVersion,
            id: rendered.template.id,
            provider: rendered.template.provider,
            label: rendered.template.label,
            profileName: rendered.profileName,
            namespace: rendered.namespace,
            secretRef: rendered.secretRef,
            command: rendered.command,
            args: rendered.args,
            configYaml: rendered.configYaml,
            secretCommands: rendered.secretCommands,
            mandateCommand: rendered.mandateCommand,
            mandatePolicy: renderedProviderMandatePolicy(rendered),
            credentialGuidance: rendered.credentialGuidance,
            notes: rendered.notes
          };
          writeOut(
            options.json
              ? JSON.stringify(result, null, 2)
              : formatProviderPresetShow(rendered)
          );
        } catch (error) {
          writeCommandError({
            json: options.json,
            code: "provider_preset_render_failed",
            message: messageFromError(error),
            nextActions: [
              "Check profile name, namespace, secretRef, and command values."
            ]
          });
        }
      }
    );

  presets
    .command("check <id>")
    .description("Check a configured profile's discovered tools against a provider safety template.")
    .requiredOption("--profile <name>", "configured profile name to inspect")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        id: string,
        options: {
          profile: string;
          json?: boolean;
        }
      ) => {
        const template = getProviderSafetyTemplate(id);
        if (!template) {
          writeCommandError({
            json: options.json,
            code: "unknown_provider_preset",
            message: `unknown provider safety template "${id}"`,
            nextActions: [
              "Run switchboard presets list to see available templates."
            ]
          });
          return;
        }

        const globalOptions = program.opts<{ cwd?: string }>();
        const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
        if (!validateLoadedConfigForJsonCommand(loaded, options.json)) {
          return;
        }

        const profile = loaded.config.profiles[options.profile];
        if (!profile) {
          writeCommandError({
            json: options.json,
            code: "profile_not_found",
            message: `profile "${options.profile}" was not found`,
            nextActions: [
              "Run switchboard status --json to inspect configured profiles."
            ]
          });
          return;
        }
        if (profile.provider !== template.provider) {
          writeCommandError({
            json: options.json,
            code: "provider_preset_profile_mismatch",
            message: `preset "${id}" expects provider "${template.provider}", but profile "${options.profile}" uses provider "${profile.provider}"`,
            nextActions: [
              `Choose a ${template.provider} profile or run switchboard presets list to pick another template.`
            ]
          });
          return;
        }

        const upstream = await profileConfigToStdioUpstreamWithSecrets(
          options.profile,
          profile,
          {
            cwdBase: configCwdBase(loaded, globalOptions.cwd),
            secretStore
          }
        ).catch((error: unknown) => {
          writeCommandError({
            json: options.json,
            code: "secret_resolution_failed",
            message: messageFromError(error),
            nextActions: secretResolutionNextActions(messageFromError(error))
          });
          return undefined;
        });
        if (!upstream) {
          if (process.exitCode) {
            return;
          }
          writeCommandError({
            json: options.json,
            code: "profile_not_stdio",
            message: `profile "${options.profile}" does not define a stdio upstream`,
            nextActions: [
              "Provider preset checks currently inspect stdio MCP profiles."
            ]
          });
          return;
        }

        try {
          const tools = await listToolsForProfiles([upstream], { auditLogger });
          const check = checkProviderSafetyTemplateTools(id, {
            namespace: upstream.namespace,
            toolNames: tools.map((tool) => tool.name)
          });
          const result = {
            ok: check.ok,
            schemaVersion: providerPresetCheckSchemaVersion,
            presetId: check.template.id,
            provider: check.template.provider,
            profileName: options.profile,
            namespace: check.namespace,
            policyCovered: check.policyCovered,
            requiresMandatePolicy: check.requiresMandatePolicy,
            counts: check.counts,
            policy: check.policy,
            tools: check.tools,
            nextActions: check.nextActions
          };
          writeOut(
            options.json
              ? JSON.stringify(result, null, 2)
              : formatProviderPresetCheck(result)
          );
          if (!result.ok) {
            process.exitCode = 1;
          }
        } catch (error) {
          writeCommandError({
            json: options.json,
            code: "provider_preset_check_failed",
            message: messageFromError(error),
            nextActions: [
              `Run switchboard test ${options.profile} to debug the upstream MCP profile.`
            ]
          });
        }
      }
    );

  program
    .command("tools")
    .description("List the configured Switchboard tool surface.")
    .option("--json", "print machine-readable JSON")
    .option("--mandate <id>", "show tools through an active mandate")
    .action(async (options: { json?: boolean; mandate?: string }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));

      if (!validateLoadedConfigForJsonCommand(loaded, options.json)) {
        return;
      }
      const mandate = options.mandate
        ? await resolveActiveMandateForCommand({
            id: options.mandate,
            cwd: globalOptions.cwd,
            mandateStorePath: io.mandateStorePath,
            writeErr,
            ...(options.json ? { json: true, writeCommandError } : {})
          })
        : undefined;
      if (options.mandate && !mandate) {
        process.exitCode = 1;
        return;
      }

      const profiles = await stdioProfilesFromConfigForCommand({
        profiles: mandate
          ? profilesForMandate(loaded.config.profiles, mandate)
          : loaded.config.profiles,
        cwdBase: configCwdBase(loaded, globalOptions.cwd),
        secretStore,
        json: options.json,
        writeCommandError,
        writeErr
      });
      if (!profiles) {
        return;
      }
      if (profiles.length === 0) {
        writeCommandError({
          json: options.json,
          code: "no_stdio_profiles",
          message: "no stdio upstream profiles are configured",
          nextActions: [
            "Add at least one generic stdio profile to Switchboard config."
          ]
        });
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
          writeOut(formatToolSurface(result, mandate?.repoPath));
        }
      } catch (error) {
        writeCommandError({
          json: options.json,
          code: "tool_surface_failed",
          message: messageFromError(error)
        });
      }
    });

  const demo = program
    .command("demo")
    .description("Print local Switchboard demo command sequences.");

  demo
    .command("mandate [profile]")
    .description("Print a local task-scoped mandate demo for one stdio profile.")
    .option("--task <task>", "demo task name")
    .option("--agent <role>", "agent role for the demo mandate", "implementer")
    .option("--branch <branch>", "branch to bind the demo mandate")
    .option("--lease <duration>", "demo mandate lease duration", "30m")
    .option(
      "--approval-tool <tool>",
      "namespaced tool to mark approval-required"
    )
    .option(
      "--approval-reason <reason>",
      "approval gate reason",
      "demo call changes pretend remote state"
    )
    .option(
      "--approval-risk <risk>",
      "approval gate risk: low, medium, high, or critical",
      "low"
    )
    .option(
      "--approval-label <label>",
      "approval gate label (repeatable)",
      collectOption,
      [] as string[]
    )
    .action(
      async (
        profileName: string | undefined,
        options: {
          task?: string;
          agent: string;
          branch?: string;
          lease: string;
          approvalTool?: string;
          approvalReason: string;
          approvalRisk: string;
          approvalLabel: string[];
        }
      ) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
        if (!validateLoadedConfigForCommand(loaded, writeErr)) {
          return;
        }

        const cwd = configCwdBase(loaded, globalOptions.cwd);
        const stdioProfiles = stdioProfilePreviewsFromConfig(
          loaded.config.profiles,
          cwd
        );
        if (stdioProfiles.length === 0) {
          writeErr("error: no stdio upstream profiles are configured");
          process.exitCode = 1;
          return;
        }

        const selectedProfile = profileName
          ? stdioProfiles.find((profile) => profile.profileName === profileName)
          : stdioProfiles[0];
        if (!selectedProfile) {
          writeErr(`error: stdio profile "${profileName}" was not found`);
          process.exitCode = 1;
          return;
        }

        const task =
          options.task?.trim() || `demo-ci-${Math.floor(Date.now() / 1000)}`;
        if (!task) {
          writeErr("error: --task must not be empty");
          process.exitCode = 1;
          return;
        }
        const mandateId = normalizeMandateId(task);
        if (!mandateId) {
          writeErr("error: --task must contain at least one letter or number");
          process.exitCode = 1;
          return;
        }
        const agent = options.agent.trim();
        if (!agent) {
          writeErr("error: --agent must not be empty");
          process.exitCode = 1;
          return;
        }
        const lease = options.lease.trim();
        if (!lease) {
          writeErr("error: --lease must not be empty");
          process.exitCode = 1;
          return;
        }

        const branch = options.branch?.trim() || currentGitBranch(cwd) || "main";
        const approvalTool =
          options.approvalTool?.trim() || `${selectedProfile.namespace}_echo`;
        const approvalLabels =
          options.approvalLabel.length > 0 ? options.approvalLabel : ["demo"];

        writeOut(
          formatDemoMandate({
            cwd,
            task,
            mandateId,
            agent,
            branch,
            lease,
            profileName: selectedProfile.profileName,
            namespace: selectedProfile.namespace,
            approvalTool,
            approvalReason: options.approvalReason,
            approvalRisk: options.approvalRisk,
            approvalLabels
          })
        );
      }
    );

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

      const profiles = await stdioProfilesFromConfigForCommand({
        profiles: mandate
          ? profilesForMandate(loaded.config.profiles, mandate)
          : loaded.config.profiles,
        cwdBase: configCwdBase(loaded, globalOptions.cwd),
        secretStore,
        json: undefined,
        writeCommandError,
        writeErr
      });
      if (!profiles) {
        return;
      }
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

        const upstream = await profileConfigToStdioUpstreamWithSecrets(
          profileName,
          profile,
          {
            cwdBase: configCwdBase(loaded, globalOptions.cwd),
            secretStore
          }
        ).catch((error: unknown) => {
          writeCommandError({
            json: options.json,
            code: "secret_resolution_failed",
            message: messageFromError(error),
            nextActions: secretResolutionNextActions(messageFromError(error))
          });
          return undefined;
        });
        if (!upstream) {
          if (process.exitCode) {
            return;
          }
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
        .argument("[task]", "task name or summary")
        .option(
          "--from <preset>",
          "use a provider safety template to fill mandate defaults and policy"
        )
        .option("--agent <role>", "agent role for this mandate")
        .option(
          "--profiles <profiles>",
          "comma-separated Switchboard profiles to bind"
        )
        .option("--branch <branch>", "branch the mandate is scoped to")
        .option("--lease <duration>", "lease duration, like 30m, 2h, or 1d")
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
        .option(
          "--require-approval-labels <labels>",
          "comma-separated labels for one approval gate (repeatable, matches --require-approval-tool order)",
          collectOption,
          [] as string[]
        )
        .option("--json", "print machine-readable JSON")
        .action(
          async (
            task: string | undefined,
            options: {
              from?: string;
              agent?: string;
              profiles?: string;
              branch?: string;
              lease?: string;
              allowTool: string[];
              denyTool: string[];
              requireApprovalTool: string[];
              requireApprovalReason: string[];
              requireApprovalRisk: string[];
              requireApprovalLabel: string[];
              requireApprovalLabels: string[];
              json?: boolean;
            }
          ) => {
            const globalOptions = program.opts<{ cwd?: string }>();
            const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
            if (!validateLoadedConfigForJsonCommand(loaded, options.json)) {
              return;
            }

            const template = options.from
              ? getProviderSafetyTemplate(options.from)
              : undefined;
            if (options.from && !template) {
              writeCommandError({
                json: options.json,
                code: "unknown_provider_preset",
                message: `unknown provider safety template "${options.from}"`,
                nextActions: [
                  "Run switchboard presets list to see available templates."
                ]
              });
              return;
            }

            const profiles = parseCommaSeparatedList(
              options.profiles ?? template?.defaultProfileName ?? ""
            );
            const taskName = task ?? template?.recommendedMandate.task;
            const agentRole = options.agent ?? template?.recommendedMandate.agent;
            const lease = options.lease ?? template?.recommendedMandate.lease;
            const missingRequired = [
              ...(taskName ? [] : ["task"]),
              ...(agentRole ? [] : ["--agent"]),
              ...(profiles.length > 0 ? [] : ["--profiles"]),
              ...(lease ? [] : ["--lease"])
            ];
            if (missingRequired.length > 0) {
              writeCommandError({
                json: options.json,
                code: "missing_mandate_options",
                message: `missing required mandate option(s): ${missingRequired.join(", ")}`,
                nextActions: [
                  "Pass the required options explicitly or use --from <preset>."
                ]
              });
              return;
            }
            if (!taskName || !agentRole || !lease) {
              return;
            }
            const missingProfiles = profiles.filter(
              (profile) => !loaded.config.profiles[profile]
            );
            if (missingProfiles.length > 0) {
              writeCommandError({
                json: options.json,
                code: "mandate_profiles_not_found",
                message: `mandate profiles were not found: ${missingProfiles.join(", ")}`,
                nextActions: ["Run switchboard status to list configured profiles."]
              });
              return;
            }

            const repoPath = configCwdBase(loaded, globalOptions.cwd);
            let gitBinding: { worktreePath: string; branch: string } | undefined;
            try {
              gitBinding = resolveGitWorktreeBinding(repoPath);
            } catch (error) {
              writeCommandError({
                json: options.json,
                code: "mandate_git_binding_failed",
                message: messageFromError(error)
              });
              return;
            }
            const branch =
              options.branch?.trim() ??
              gitBinding?.branch ??
              template?.recommendedMandate.branch;
            if (!branch) {
              writeCommandError({
                json: options.json,
                code: "missing_mandate_options",
                message: "missing required mandate option(s): --branch",
                nextActions: [
                  "Pass --branch explicitly or run from a git worktree."
                ]
              });
              return;
            }
            if (gitBinding && gitBinding.branch !== branch) {
              writeCommandError({
                json: options.json,
                code: "mandate_branch_mismatch",
                message: `mandate branch "${branch}" does not match current git branch "${gitBinding.branch}" in ${gitBinding.worktreePath}`,
                nextActions: [
                  `Switch to branch "${branch}" or pass --branch "${gitBinding.branch}".`
                ]
              });
              return;
            }
            if (
              options.requireApprovalReason.length > 0 &&
              options.requireApprovalReason.length !==
                options.requireApprovalTool.length
            ) {
              writeCommandError({
                json: options.json,
                code: "invalid_approval_gate_options",
                message: "--require-approval-reason must be provided once for each --require-approval-tool"
              });
              return;
            }
            if (
              options.requireApprovalRisk.length > 0 &&
              options.requireApprovalRisk.length !==
                options.requireApprovalTool.length
            ) {
              writeCommandError({
                json: options.json,
                code: "invalid_approval_gate_options",
                message: "--require-approval-risk must be provided once for each --require-approval-tool"
              });
              return;
            }
            if (
              options.requireApprovalLabels.length > 0 &&
              options.requireApprovalLabels.length !==
                options.requireApprovalTool.length
            ) {
              writeCommandError({
                json: options.json,
                code: "invalid_approval_gate_options",
                message: "--require-approval-labels must be provided once for each --require-approval-tool"
              });
              return;
            }
            const path = io.mandateStorePath ?? resolveMandateStorePath();
            const templatePolicy = template
              ? providerSafetyTemplatePolicy(
                  template.id,
                  loaded.config.profiles[profiles[0] ?? ""]?.namespace ??
                    template.defaultNamespace
                )
              : undefined;
            const manualApprovalGates = options.requireApprovalTool.map(
              (toolPattern, index) => ({
                toolPattern,
                ...(options.requireApprovalReason[index]
                  ? { reason: options.requireApprovalReason[index] }
                  : {}),
                ...(options.requireApprovalRisk[index]
                  ? { risk: options.requireApprovalRisk[index] }
                  : {}),
                ...(approvalGateLabels(options, index).length > 0
                  ? { labels: approvalGateLabels(options, index) }
                  : {})
              })
            );

            try {
              const mandate = await createMandate({
                path,
                task: taskName,
                repoPath,
                worktreePath: gitBinding?.worktreePath ?? repoPath,
                branch,
                agentRole,
                profiles,
                lease,
                allowedTools: [
                  ...(templatePolicy?.allowedTools ?? []),
                  ...options.allowTool
                ],
                deniedTools: [
                  ...(templatePolicy?.deniedTools ?? []),
                  ...options.denyTool
                ],
                approvalRequiredTools: [
                  ...(templatePolicy?.approvalGates ?? []),
                  ...manualApprovalGates
                ]
              });
              if (options.json) {
                const mcpLaunch = createMandateMcpLaunchPayload(mandate);
                writeOut(
                  JSON.stringify(
                    {
                      path,
                      mandate,
                      mcpLaunch,
                      workspaceLease: createWorkspaceLeasePayload(mandate, mcpLaunch)
                    },
                    null,
                    2
                  )
                );
              } else {
                writeOut(formatMandateCreated(path, mandate));
              }
            } catch (error) {
              const commandError = mandateCommandError(
                error,
                "mandate_create_failed"
              );
              writeCommandError({
                json: options.json,
                code: commandError.code,
                message: commandError.message,
                nextActions: commandError.nextActions
              });
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
        .option(
          "--require-approval-labels <labels>",
          "comma-separated labels for one approval gate (repeatable, matches --require-approval-tool order)",
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
              requireApprovalLabels: string[];
              json?: boolean;
            }
          ) => {
            const globalOptions = program.opts<{ cwd?: string }>();
            const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
            if (!validateLoadedConfigForJsonCommand(loaded, options.json)) {
              return;
            }

            const profiles = parseCommaSeparatedList(options.profiles);
            const missingProfiles = profiles.filter(
              (profile) => !loaded.config.profiles[profile]
            );
            if (missingProfiles.length > 0) {
              writeCommandError({
                json: options.json,
                code: "child_mandate_profiles_not_found",
                message: `child mandate profiles were not found: ${missingProfiles.join(", ")}`,
                nextActions: ["Run switchboard status to list configured profiles."]
              });
              return;
            }

            const repoPath = configCwdBase(loaded, globalOptions.cwd);
            let gitBinding: { worktreePath: string; branch: string } | undefined;
            try {
              gitBinding = resolveGitWorktreeBinding(repoPath);
            } catch (error) {
              writeCommandError({
                json: options.json,
                code: "child_mandate_git_binding_failed",
                message: messageFromError(error)
              });
              return;
            }
            const branch = options.branch.trim();
            if (gitBinding && gitBinding.branch !== branch) {
              writeCommandError({
                json: options.json,
                code: "child_mandate_branch_mismatch",
                message: `child mandate branch "${branch}" does not match current git branch "${gitBinding.branch}" in ${gitBinding.worktreePath}`,
                nextActions: [
                  `Switch to branch "${branch}" or pass --branch "${gitBinding.branch}".`
                ]
              });
              return;
            }
            if (
              options.requireApprovalReason.length > 0 &&
              options.requireApprovalReason.length !==
                options.requireApprovalTool.length
            ) {
              writeCommandError({
                json: options.json,
                code: "invalid_approval_gate_options",
                message: "--require-approval-reason must be provided once for each --require-approval-tool"
              });
              return;
            }
            if (
              options.requireApprovalRisk.length > 0 &&
              options.requireApprovalRisk.length !==
                options.requireApprovalTool.length
            ) {
              writeCommandError({
                json: options.json,
                code: "invalid_approval_gate_options",
                message: "--require-approval-risk must be provided once for each --require-approval-tool"
              });
              return;
            }
            if (
              options.requireApprovalLabels.length > 0 &&
              options.requireApprovalLabels.length !==
                options.requireApprovalTool.length
            ) {
              writeCommandError({
                json: options.json,
                code: "invalid_approval_gate_options",
                message: "--require-approval-labels must be provided once for each --require-approval-tool"
              });
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
                    ...(approvalGateLabels(options, index).length > 0
                      ? { labels: approvalGateLabels(options, index) }
                      : {})
                  })
                )
              });
              if (options.json) {
                const mcpLaunch = createMandateMcpLaunchPayload(mandate);
                writeOut(
                  JSON.stringify(
                    {
                      path,
                      mandate,
                      mcpLaunch,
                      workspaceLease: createWorkspaceLeasePayload(mandate, mcpLaunch)
                    },
                    null,
                    2
                  )
                );
              } else {
                writeOut(formatMandateCreated(path, mandate));
              }
            } catch (error) {
              const commandError = mandateCommandError(
                error,
                "child_mandate_create_failed"
              );
              writeCommandError({
                json: options.json,
                code: commandError.code,
                message: commandError.message,
                nextActions: commandError.nextActions
              });
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
        .option(
          "--ignore-readiness",
          "close even when local readiness blockers remain"
        )
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
              ignoreReadiness?: boolean;
              json?: boolean;
            }
          ) => {
            const state = parseHandoffState(options.state);
            if (!state) {
              writeCommandError({
                json: options.json,
                code: "invalid_handoff_state",
                message: "--state must be completed, blocked, or cancelled"
              });
              return;
            }

            const globalOptions = program.opts<{ cwd?: string }>();
            const repoPath = installTargetCwd(globalOptions.cwd);
            const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
            const path = io.mandateStorePath ?? resolveMandateStorePath();
            const auditLogPath = io.auditLogPath ?? resolveAuditLogPath();
            const approvalStorePath =
              io.approvalStorePath ?? resolveApprovalRequestStorePath();
            try {
              if (!options.ignoreReadiness) {
                const report = await createMandateReportPayload({
                  id,
                  path,
                  auditLogPath,
                  approvalStorePath,
                  logLimit: 1,
                  repoPath,
                  config: loaded.config,
                  secretStore
                });
                if (report.readiness.blockers.length > 0) {
                  writeCommandError({
                    json: options.json,
                    code: "mandate_readiness_blocked",
                    message: `cannot hand off mandate "${normalizeMandateId(id)}" while readiness blockers remain: ${report.readiness.blockers.join("; ")}. Use --ignore-readiness to close anyway.`,
                    nextActions: report.readiness.nextActions
                  });
                  return;
                }
              }
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
              const commandError = mandateCommandError(
                error,
                "mandate_handoff_failed"
              );
              writeCommandError({
                json: options.json,
                code: commandError.code,
                message: commandError.message,
                nextActions: commandError.nextActions
              });
            }
          }
        )
    )
    .addCommand(
      new Command("escalate")
        .description("Build a local escalation plan for a mandate tree.")
        .argument("<id>", "root or child mandate id to escalate")
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
              writeCommandError({
                json: options.json,
                code: "invalid_log_limit",
                message: "--log-limit must be a positive integer"
              });
              return;
            }

            const globalOptions = program.opts<{ cwd?: string }>();
            const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
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
                ...(repoPath ? { repoPath } : {}),
                ...(repoPath ? { config: loaded.config, secretStore } : {})
              });
              const escalation = createMandateEscalationPayload(report);
              writeOut(
                options.json
                  ? JSON.stringify(escalation, null, 2)
                  : formatMandateEscalation(escalation)
              );
            } catch (error) {
              const commandError = mandateCommandError(
                error,
                "mandate_escalate_failed"
              );
              writeCommandError({
                json: options.json,
                code: commandError.code,
                message: commandError.message,
                nextActions: commandError.nextActions
              });
            }
          }
        )
    )
    .addCommand(
      new Command("renew")
        .description("Renew an open mandate lease from now.")
        .argument("<id>", "mandate id to renew")
        .requiredOption("--lease <duration>", "new lease duration, like 30m, 2h, or 1d")
        .option("--json", "print machine-readable JSON")
        .action(
          async (
            id: string,
            options: { lease: string; json?: boolean }
          ) => {
            const globalOptions = program.opts<{ cwd?: string }>();
            const repoPath = installTargetCwd(globalOptions.cwd);
            const path = io.mandateStorePath ?? resolveMandateStorePath();
            try {
              const mandate = await renewMandate({
                path,
                id,
                repoPath,
                lease: options.lease
              });
              const result = { path, mandate };
              writeOut(
                options.json
                  ? JSON.stringify(result, null, 2)
                  : [
                      `Renewed mandate ${mandate.id}`,
                      `Runtime: ${mandate.runtimeStatus}`,
                      `Lease: ${mandate.lease}`,
                      `Expires: ${mandate.expiresAt}`,
                      `Store: ${path}`
                    ].join("\n")
              );
            } catch (error) {
              const commandError = mandateCommandError(
                error,
                "mandate_renew_failed"
              );
              writeCommandError({
                json: options.json,
                code: commandError.code,
                message: commandError.message,
                nextActions: commandError.nextActions
              });
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
              writeCommandError({
                json: options.json,
                code: "invalid_log_limit",
                message: "--log-limit must be a positive integer"
              });
              return;
            }

            const globalOptions = program.opts<{ cwd?: string }>();
            const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
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
                ...(repoPath ? { repoPath } : {}),
                ...(repoPath ? { config: loaded.config, secretStore } : {})
              });
              writeOut(
                options.json
                  ? JSON.stringify(report, null, 2)
                  : formatMandateReport(report)
              );
            } catch (error) {
              const commandError = mandateCommandError(
                error,
                "mandate_report_failed"
              );
              writeCommandError({
                json: options.json,
                code: commandError.code,
                message: commandError.message,
                nextActions: commandError.nextActions
              });
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
            let mandates: MandateWithStatus[];
            try {
              mandates = await listMandates({
                path,
                ...(repoPath ? { repoPath } : {}),
                ...(id ? { id } : {})
              });
            } catch (error) {
              writeCommandError({
                json: options.json,
                code: "mandate_status_failed",
                message: messageFromError(error)
              });
              return;
            }
            const result = {
              schemaVersion: mandateStatusSchemaVersion,
              path,
              repoPath: repoPath ?? null,
              mandates,
              readiness: await createMandateStatusReadiness({
                mandates,
                repoPath,
                cwd: globalOptions.cwd,
                secretStore
              })
            };

            if (id && mandates.length === 0) {
              writeCommandError({
                json: options.json,
                code: "mandate_not_found",
                message: `mandate "${id}" was not found`,
                nextActions: [
                  "Run switchboard mandate status to list mandates for this repo."
                ]
              });
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
          writeCommandError({
            json: options.json,
            code: "invalid_status",
            message: "--status must be pending, approved, denied, stale, or expired",
            nextActions: [
              "Pass --status as pending, approved, denied, stale, or expired."
            ]
          });
          return;
        }
        if (options.includeChildren && !options.mandate) {
          writeCommandError({
            json: options.json,
            code: "missing_mandate",
            message: "--include-children requires --mandate <id>",
            nextActions: [
              "Pass --mandate <id> with --include-children."
            ]
          });
          return;
        }
        if (options.includeChildren && options.all) {
          writeCommandError({
            json: options.json,
            code: "invalid_scope",
            message: "--include-children must be repo-scoped; remove --all",
            nextActions: [
              "Remove --all when using --include-children."
            ]
          });
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
          const { code, message } = mandateCommandError(
            error,
            "approval_requests_failed"
          );
          writeCommandError({
            json: options.json,
            code,
            message
          });
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
        if (options.json) {
          writeOut(
            JSON.stringify(
              commandErrorEnvelope({
                json: true,
                code: "invalid_limit",
                message: "--limit must be a positive integer",
                nextActions: ["Pass --limit with a positive integer value."]
              }),
              null,
              2
            )
          );
          process.exitCode = 1;
          return;
        }

        writeErr("error: --limit must be a positive integer");
        process.exitCode = 1;
        return;
      }

      const path = io.auditLogPath ?? resolveAuditLogPath();
      const matchingEntries = await readAuditLogEntries({
        path,
        ...(options.mandate ? { mandateId: options.mandate } : {})
      });
      const entries = matchingEntries.slice(
        Math.max(matchingEntries.length - limit, 0)
      );
      if (options.json) {
        const payload: AuditLogPayload = {
          ok: true,
          schemaVersion: auditLogSchemaVersion,
          path,
          mandateId: options.mandate ?? null,
          filters: {
            mandateId: options.mandate ?? null,
            limit
          },
          counts: {
            totalMatching: matchingEntries.length,
            returned: entries.length
          },
          entries
        };
        writeOut(
          JSON.stringify(payload, null, 2)
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
    .option("--command <command>", "Switchboard executable command")
    .option(
      "--command-arg <arg>",
      "argument to place before Switchboard's --cwd/mcp args; repeatable",
      collectOption,
      []
    )
    .action(
      async (
        client: string,
        options: {
          json?: boolean;
          write?: boolean;
          rollback?: string;
          serverName: string;
          command?: string;
          commandArg: string[];
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
        const profiles = stdioProfilePreviewsFromConfig(
          loaded.config.profiles,
          cwd
        );
        if (profiles.length === 0) {
          writeErr("error: no stdio upstream profiles are configured");
          process.exitCode = 1;
          return;
        }

        const launch = resolveInstallLaunch({
          ...(options.command !== undefined ? { command: options.command } : {}),
          commandArgs: options.commandArg
        });
        const clientConfigOptions = {
          client: supportedClient,
          serverName: options.serverName,
          command: launch.command,
          commandArgs: launch.commandArgs,
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

  configureParserErrorHandling(program, {
    writeOut,
    writeErr,
    currentParseArgs: () => currentParseArgs,
    writeCommandError
  });
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

function formatScan(result: SwitchboardScanResult): string {
  const lines = [`This looks like ${result.repo.name}.`, "", "Repo:"];
  const remoteLabel =
    result.repo.remote.provider === "github" &&
    result.repo.remote.owner &&
    result.repo.remote.repo
      ? `GitHub: ${result.repo.remote.owner}/${result.repo.remote.repo}`
      : result.repo.remote.url
        ? `remote: ${result.repo.remote.url}`
        : "remote: not detected";
  lines.push(`- ${remoteLabel}`);
  lines.push(`- branch: ${result.repo.branch ?? "unknown"}`);
  lines.push(`- runtime: ${formatScanRuntime(result)}`);

  const detected = formatScanDetected(result);
  if (detected.length > 0) {
    lines.push("", "Detected:", ...detected.map((line) => `- ${line}`));
  }

  if (result.providers.length > 0) {
    lines.push(
      "",
      "Provider hints:",
      ...result.providers.map((provider) => {
        const env =
          provider.environment === "unknown"
            ? ""
            : `, ${provider.environment}`;
        const vars =
          provider.envVars.length > 0
            ? `: ${provider.envVars.join(", ")}`
            : "";
        return `- ${provider.provider}${env}${vars}`;
      })
    );
  }

  if (result.bypassFindings.length > 0) {
    lines.push(
      "",
      "Authority bypasses:",
      ...result.bypassFindings.map(formatBypassFindingLine)
    );
  }

  const providerSuggestions = result.suggestions.filter(
    (suggestion) => suggestion.kind === "provider-profile"
  );
  if (providerSuggestions.length > 0) {
    lines.push(
      "",
      "Suggested setup:",
      ...providerSuggestions.map((suggestion) => {
        const name = suggestion.profileName ?? suggestion.provider ?? "profile";
        return `- ${name}: ${formatHumanCommand(suggestion.command)}`;
      })
    );
  }

  if (result.recommendedNextAction.primary) {
    lines.push("", "Recommended next:");
    lines.push(
      `- ${formatHumanCommand(result.recommendedNextAction.primary.command)}`
    );
    lines.push(`  ${result.recommendedNextAction.primary.reason}`);
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  }

  if (result.nextActions.length > 0) {
    lines.push(
      "",
      "Next:",
      ...result.nextActions.map((action) => `- ${formatHumanCommand(action)}`)
    );
  }

  return lines.join("\n");
}

function rewriteScanCommandsForCurrentInvocation(
  result: SwitchboardScanResult
): SwitchboardScanResult {
  const prefix = switchboardCommandPrefixForRepo(
    result.repo.gitRoot ?? result.repo.cwd
  );
  if (prefix === "switchboard") {
    return result;
  }

  return {
    ...result,
    suggestions: result.suggestions.map((suggestion) => ({
      ...suggestion,
      command: rewriteSwitchboardCommand(suggestion.command, prefix)
    })),
    recommendedNextAction: rewriteRecommendedNextAction(
      result.recommendedNextAction,
      prefix
    ),
    nextActions: result.nextActions.map((action) =>
      rewriteSwitchboardCommand(action, prefix)
    )
  };
}

function rewriteImportCommandsForCurrentInvocation(
  plan: SwitchboardImportPlan
): SwitchboardImportPlan {
  const prefix = switchboardCommandPrefixForRepo(plan.repo.cwd);
  if (prefix === "switchboard") {
    return plan;
  }

  return {
    ...plan,
    actions: plan.actions.map((action) => ({
      ...action,
      ...(action.command
        ? { command: rewriteCommandShape(action.command, prefix) }
        : {})
    })),
    commands: {
      dryRun: rewriteCommandShape(plan.commands.dryRun, prefix),
      writePreview: rewriteCommandShape(plan.commands.writePreview, prefix),
      cleanupClient: rewriteCommandShape(plan.commands.cleanupClient, prefix),
      installClients: plan.commands.installClients.map((command) =>
        rewriteCommandShape(command, prefix)
      ),
      secretCommands: plan.commands.secretCommands.map((command) =>
        rewriteCommandShape(command, prefix)
      )
    },
    recommendedNextAction: rewriteRecommendedNextAction(
      plan.recommendedNextAction,
      prefix
    ),
    nextActions: plan.nextActions.map((action) =>
      rewriteSwitchboardCommand(action, prefix)
    )
  };
}

function rewriteWrittenImportCommandsForCurrentInvocation(
  result: WrittenSwitchboardImportPlan
): WrittenSwitchboardImportPlan {
  return {
    ...result,
    plan: rewriteImportCommandsForCurrentInvocation(result.plan)
  };
}

function rewriteCommandShape(
  command: { command: string; args: string[] },
  prefix: string
): { command: string; args: string[] } {
  if (prefix === "switchboard") {
    return command;
  }

  const parts = splitCommandPrefix(prefix);
  return {
    command: parts[0] ?? command.command,
    args: [...parts.slice(1), ...command.args]
  };
}

function rewriteRecommendedNextAction(
  action: RecommendedNextAction,
  prefix: string
): RecommendedNextAction {
  return {
    primary: action.primary
      ? {
          ...action.primary,
          command: rewriteSwitchboardCommand(action.primary.command, prefix)
        }
      : null,
    alternatives: action.alternatives.map((item) => ({
      ...item,
      command: rewriteSwitchboardCommand(item.command, prefix)
    }))
  };
}

async function createNextActionResult(options: {
  cwd?: string | undefined;
  secretStore: SecretStore;
}): Promise<RecommendedNextAction> {
  const doctor = await createDoctorResult(options);
  const scan = rewriteScanCommandsForCurrentInvocation(
    await scanSwitchboardProject({
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...resolveInstallLaunch({ commandArgs: [] })
    })
  );
  return planRecommendedNextAction([
    ...recommendedNextActionCandidates(scan.recommendedNextAction),
    ...recommendedNextActionCandidates(doctor.recommendedNextAction)
  ]);
}

function recommendedNextActionCandidates(
  action: RecommendedNextAction
): NextActionCandidate[] {
  return [
    ...(action.primary ? [action.primary] : []),
    ...action.alternatives
  ];
}

function splitCommandPrefix(prefix: string): string[] {
  const matches = [
    ...prefix.matchAll(/'([^']*(?:'\\''[^']*)*)'|("[^"]*")|(\S+)/g)
  ];
  return matches
    .map((match) => match[1] ?? match[2]?.slice(1, -1) ?? match[3] ?? "")
    .map((part) => part.replace(/'\\''/g, "'"))
    .filter((part) => part.length > 0);
}

function rewriteSwitchboardCommand(command: string, prefix: string): string {
  return command === "switchboard"
    ? prefix
    : command.startsWith("switchboard ")
      ? `${prefix}${command.slice("switchboard".length)}`
      : command;
}

function switchboardCommandPrefixForRepo(repoPath: string): string {
  const sourceRoot = sourceCheckoutRoot();
  if (!sourceRoot) {
    return "switchboard";
  }

  return [
    "pnpm",
    "--dir",
    shellQuoteCommandArg(sourceRoot),
    "switchboard",
    "--cwd",
    shellQuoteCommandArg(repoPath)
  ].join(" ");
}

function formatScanRuntime(result: SwitchboardScanResult): string {
  const labels: string[] = [result.runtime.kind];
  if (result.runtime.devcontainerPresent) {
    labels.push("devcontainer present");
  }
  if (result.runtime.vercelProjectPresent) {
    labels.push("Vercel project linked");
  }
  return labels.join(", ");
}

function formatScanDetected(result: SwitchboardScanResult): string[] {
  const lines: string[] = [];
  for (const client of result.clients) {
    lines.push(`${capitalize(client.client)} project MCP config ${client.status}`);
    for (const name of client.otherServerNames) {
      lines.push(`${capitalize(client.client)} also has MCP server "${name}"`);
    }
  }
  if (result.switchboard.profileNames.length > 0) {
    lines.push(
      `Switchboard profiles: ${result.switchboard.profileNames.join(", ")}`
    );
  }
  if (result.switchboard.workspaceNames.length > 0) {
    lines.push(
      `Switchboard workspaces: ${result.switchboard.workspaceNames.join(", ")}`
    );
  }
  for (const provider of result.providers) {
    for (const source of provider.sources) {
      if (source.kind === "env-file") {
        lines.push(
          `${shortPath(source.path)} mentions ${provider.provider.toUpperCase()} env names`
        );
      } else if (source.detail) {
        lines.push(source.detail);
      }
    }
  }
  return [...new Set(lines)];
}

function formatImportPlan(plan: SwitchboardImportPlan): string {
  const lines = [
    `Switchboard import plan for ${plan.repo.name}`,
    "Dry run: no files were written.",
    "",
    "Detected:"
  ];

  for (const client of plan.detected.clients) {
    lines.push(
      `- ${capitalize(client.client)} project MCP config ${formatImportClientStatus(client.status)} (${client.targetPath})`
    );
    for (const server of client.servers) {
      if (server.routesThroughSwitchboard) {
        lines.push(`  - ${server.name}: already routes through Switchboard`);
        continue;
      }
      const provider =
        server.provider === "unknown" ? "provider unknown" : server.provider;
      const env =
        server.envKeys.length > 0
          ? `; env names: ${server.envKeys.join(", ")}`
          : "";
      lines.push(
        `  - ${server.name}: ${provider} -> ${server.suggestedProfileName}${env}`
      );
    }
  }

  if (plan.detected.switchboardProfiles.length > 0) {
    lines.push(
      "",
      "Existing Switchboard profiles:",
      ...plan.detected.switchboardProfiles.map((profile) => {
        const provider = profile.provider ? ` (${profile.provider})` : "";
        const namespace = profile.namespace ? ` namespace ${profile.namespace}` : "";
        return `- ${profile.name}${provider}${namespace}`;
      })
    );
  }

  if (plan.detected.envFiles.length > 0) {
    lines.push(
      "",
      "Env files:",
      ...plan.detected.envFiles.map(
        (file) => `- ${shortPath(file.path)}: ${file.envKeys.join(", ")}`
      )
    );
  }

  if (plan.bypassFindings.length > 0) {
    lines.push(
      "",
      "Authority bypasses:",
      ...plan.bypassFindings.map(formatBypassFindingLine)
    );
  }

  if (plan.cleanupPlan.some((item) => item.status === "planned")) {
    lines.push("", "Client cleanup plan:");
    for (const item of plan.cleanupPlan.filter(
      (cleanup) => cleanup.status === "planned"
    )) {
      lines.push(
        `- ${capitalize(item.client)} ${item.targetPath}: remove ${item.affectedServerNames.join(", ")}`
      );
      lines.push(`  rollback after write: ${item.rollbackCommand}`);
      lines.push(`  ${item.acceptedRiskGuidance}`);
    }
    lines.push(
      `  ${formatHumanCommand(renderCommandShape(plan.commands.cleanupClient))}`
    );
  }

  if (plan.actions.length > 0) {
    lines.push("", "Recommended cleanup:");
    for (const action of plan.actions) {
      lines.push(`- ${action.title}`);
      lines.push(`  ${action.reason}`);
      if (action.command) {
        lines.push(`  ${formatHumanCommand(renderCommandShape(action.command))}`);
      }
    }
  }

  if (plan.recommendedNextAction.primary) {
    lines.push("", "Recommended next:");
    lines.push(
      `- ${formatHumanCommand(plan.recommendedNextAction.primary.command)}`
    );
    lines.push(`  ${plan.recommendedNextAction.primary.reason}`);
  }

  if (plan.warnings.length > 0) {
    lines.push("", "Warnings:", ...plan.warnings.map((warning) => `- ${warning}`));
  }

  lines.push(
    "",
    "Safety notes:",
    ...plan.safetyNotes.map((note) => `- ${note}`)
  );

  if (plan.nextActions.length > 0) {
    lines.push(
      "",
      "Next:",
      ...plan.nextActions.map((action) => `- ${formatHumanCommand(action)}`)
    );
  }

  return lines.join("\n");
}

function formatImportWriteJson(
  result: WrittenSwitchboardImportPlan
): Record<string, unknown> {
  return {
    ok: true,
    schemaVersion: result.schemaVersion,
    action: result.action,
    targetPath: result.targetPath,
    backupPath: result.backupPath,
    createdProfiles: result.createdProfiles,
    clientCleanup: result.clientCleanup,
    plan: result.plan,
    nextContent: result.nextContent
  };
}

function formatImportWrite(result: WrittenSwitchboardImportPlan): string {
  const cleanupUpdated = result.clientCleanup.some(
    (item) => item.status === "updated"
  );
  if (result.action === "noop" && !cleanupUpdated) {
    return [
      `Switchboard import found nothing new for ${result.plan.repo.name}`,
      "No files were written.",
      "",
      "Detected setup:",
      ...result.plan.detected.clients.map(
        (client) =>
          `- ${capitalize(client.client)} project MCP config ${formatImportClientStatus(client.status)}`
      ),
      "",
      "Next:",
      ...result.plan.nextActions.map((action) => `- ${formatHumanCommand(action)}`)
    ].join("\n");
  }

  return [
    `Switchboard import ${result.action}`,
    `Target: ${result.targetPath}`,
    ...(result.backupPath ? [`Backup: ${result.backupPath}`] : []),
    `Profiles: ${
      result.createdProfiles.length > 0 ? result.createdProfiles.join(", ") : "none"
    }`,
    ...formatClientCleanupWriteLines(result),
    "",
    "What changed:",
    "- Created Switchboard profiles for existing project MCP servers.",
    "- Stored secret-looking env names as local token aliases in config.",
    result.clientCleanup.some((item) => item.status === "updated")
      ? "- Removed direct MCP bypass routes from active Codex/Claude project config with backups."
      : "- Left Codex and Claude client config untouched.",
    "",
    "Next:",
    ...result.plan.nextActions.map((action) => `- ${formatHumanCommand(action)}`)
  ].join("\n");
}

function formatClientCleanupWriteLines(
  result: WrittenSwitchboardImportPlan
): string[] {
  if (result.clientCleanup.length === 0) {
    return [];
  }

  const lines = ["", "Client cleanup:"];
  for (const item of result.clientCleanup) {
    lines.push(
      `- ${capitalize(item.client)} ${item.status}: ${
        item.affectedServerNames.length > 0
          ? item.affectedServerNames.join(", ")
          : "no direct routes"
      }`
    );
    if (item.backupPath) {
      lines.push(`  Backup: ${item.backupPath}`);
    }
    if (item.rollbackCommand) {
      lines.push(`  Rollback: ${item.rollbackCommand}`);
    }
    lines.push(`  ${item.acceptedRiskGuidance}`);
  }
  return lines;
}

function formatImportClientStatus(status: string): string {
  if (status === "detected") {
    return "found";
  }
  if (status === "missing") {
    return "missing";
  }
  return status;
}

function renderCommandShape(command: { command: string; args: string[] }): string {
  return [command.command, ...command.args.map(shellQuoteCommandArg)].join(" ");
}

async function createDoctorResult(options: {
  cwd?: string | undefined;
  secretStore: SecretStore;
}): Promise<{
  ok: boolean;
  status: "ok" | "setup-incomplete" | "failed";
  checks: Array<{ name: string; ok: boolean; message: string }>;
  diagnostics: ReturnType<typeof loadSwitchboardConfig>["diagnostics"];
  namespaceCollisions: ReturnType<typeof loadSwitchboardConfig>["namespaceCollisions"];
  clientConfigs: ProjectClientConfigInspection[];
  clientLaunches: ClientLaunchCheck[];
  secrets: {
    usages: ReturnType<typeof collectSecretRefUsages>;
    missing: MissingSecretRef[];
  };
  bypassFindings: BypassFinding[];
  recommendedNextAction: RecommendedNextAction;
  nextSteps: string[];
}> {
  const configOptions = optionsFromCwd(options.cwd);
  const loaded = loadSwitchboardConfig(configOptions);
  const localIgnore = checkLocalConfigIgnored(options.cwd);
  const cwd = configCwdBase(loaded, options.cwd);
  const launch = resolveInstallLaunch({ commandArgs: [] });
  const clientConfigs = await inspectProjectClientConfigs({
    cwd,
    command: launch.command,
    commandArgs: launch.commandArgs
  });
  const clientLaunches = await checkInstalledClientLaunches(clientConfigs);
  const missingSecrets = await findMissingSecretRefs(
    loaded.config,
    options.secretStore
  );
  const importPlan = await createSwitchboardImportPlan({
    cwd,
    env: process.env
  });
  const bypassFindings = importPlan.bypassFindings;
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
    },
    {
      name: "client-launch",
      ok: clientLaunches.every((item) => item.ok),
      message: clientLaunchSummary(clientLaunches)
    },
    {
      name: "secrets",
      ok: missingSecrets.length === 0,
      message: secretCheckSummary(missingSecrets)
    },
    {
      name: "direct-mcp-bypass",
      ok: bypassFindings.length === 0,
      message: bypassCheckSummary(bypassFindings)
    }
  ];
  const ok = checks.every((check) => check.ok);
  const nextSteps = doctorNextSteps({
    ok,
    loaded,
    localIgnoreOk: localIgnore.ok,
    clientConfigs,
    clientLaunches,
    missingSecrets,
    bypassFindings,
    cwd: options.cwd
  }).map((step) =>
    rewriteSwitchboardCommand(step, switchboardCommandPrefixForRepo(cwd))
  );
  const status = doctorStatus({ ok, nextSteps });
  const recommendedNextAction = rewriteRecommendedNextAction(
    planRecommendedNextAction(
      doctorNextActionCandidates({
        loaded,
        localIgnoreOk: localIgnore.ok,
        clientConfigs,
        clientLaunches,
        missingSecrets,
        bypassFindings,
        nextSteps
      })
    ),
    switchboardCommandPrefixForRepo(cwd)
  );

  return {
    ok,
    status,
    checks,
    diagnostics: loaded.diagnostics,
    namespaceCollisions: loaded.namespaceCollisions,
    clientConfigs,
    clientLaunches,
    secrets: {
      usages: collectSecretRefUsages(loaded.config),
      missing: missingSecrets
    },
    bypassFindings,
    recommendedNextAction,
    nextSteps
  };
}

function doctorNextActionCandidates(options: {
  loaded: ReturnType<typeof loadSwitchboardConfig>;
  localIgnoreOk: boolean;
  clientConfigs: ProjectClientConfigInspection[];
  clientLaunches: ClientLaunchCheck[];
  missingSecrets: MissingSecretRef[];
  bypassFindings: BypassFinding[];
  nextSteps: string[];
}): NextActionCandidate[] {
  const candidates: NextActionCandidate[] = [];
  if (options.loaded.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
    candidates.push({
      kind: "invalid-config",
      command: "switchboard doctor",
      reason: "Fix config diagnostics before granting agent authority."
    });
  }
  for (const missing of options.missingSecrets) {
    candidates.push({
      kind: "missing-secret",
      command: `switchboard secrets set ${missing.ref} --value-stdin`,
      reason: `Set ${missing.ref} before launching agents.`
    });
  }
  if (options.bypassFindings.length > 0) {
    candidates.push({
      kind: "bypass-cleanup",
      command: "switchboard import --write --cleanup-client",
      reason: "Remove direct MCP bypass routes from active client config."
    });
  }
  for (const config of options.clientConfigs) {
    if (config.status === "missing" || config.status === "stale") {
      candidates.push({
        kind: "client-install",
        command: `switchboard install ${config.client} --write`,
        reason: `Route ${config.client} through Switchboard MCP.`
      });
    }
  }
  for (const launch of options.clientLaunches) {
    if (!launch.ok) {
      candidates.push({
        kind: "client-install",
        command: `switchboard install ${launch.client} --write`,
        reason: launch.message
      });
    }
  }
  for (const step of options.nextSteps) {
    candidates.push({
      kind: step.includes("mandate create") ? "mandate-create" : "info",
      command: step,
      reason: "Doctor suggested this follow-up."
    });
  }
  return candidates;
}

function formatDoctor(result: {
  ok: boolean;
  status: "ok" | "setup-incomplete" | "failed";
  checks: Array<{ name: string; ok: boolean; message: string }>;
  diagnostics: Array<{ level: string; message: string }>;
  clientConfigs?: ProjectClientConfigInspection[];
  clientLaunches?: ClientLaunchCheck[];
  secrets?: {
    usages: ReturnType<typeof collectSecretRefUsages>;
    missing: MissingSecretRef[];
  };
  bypassFindings?: BypassFinding[];
  recommendedNextAction?: RecommendedNextAction;
  nextSteps: string[];
}): string {
  const lines = [`Switchboard doctor: ${formatDoctorStatus(result.status)}`];
  lines.push(formatDoctorReadinessLine(result.status));

  for (const check of result.checks) {
    lines.push(`${check.ok ? "ok" : "fail"} ${check.name} - ${check.message}`);
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.level}: ${diagnostic.message}`);
  }

  if (result.clientConfigs && result.clientConfigs.length > 0) {
    lines.push("", "Agent clients:");
    for (const config of result.clientConfigs) {
      const otherServers =
        config.otherServerNames.length > 0
          ? `; other MCP servers: ${config.otherServerNames.join(", ")}`
          : "";
      lines.push(
        `  ${config.client}: ${formatClientConfigStatus(config.status)} - ${config.message}${otherServers} (${config.targetPath})`
      );
    }
  }

  if (result.clientLaunches && result.clientLaunches.length > 0) {
    lines.push("", "Agent launch:");
    for (const launch of result.clientLaunches) {
      lines.push(
        `  ${launch.ok ? "ok" : "fail"} ${launch.client}: ${launch.message}`
      );
    }
  }

  if (result.secrets && result.secrets.usages.length > 0) {
    lines.push("", "Local tokens:");
    for (const usage of result.secrets.usages) {
      const missing = result.secrets.missing.some(
        (item) => item.ref === usage.ref
      )
        ? "missing"
        : "set";
      lines.push(
        `  ${usage.profileName}.${usage.envName}: ${missing} (stored as ${usage.ref})`
      );
    }
  }

  if (result.bypassFindings && result.bypassFindings.length > 0) {
    lines.push("", "Authority bypasses:");
    for (const finding of result.bypassFindings) {
      lines.push(formatBypassFindingLine(finding));
      for (const reason of finding.reasons) {
        lines.push(`    ${reason}`);
      }
    }
  }

  if (result.recommendedNextAction?.primary) {
    lines.push("", "Recommended next:");
    lines.push(
      `  ${formatHumanCommand(result.recommendedNextAction.primary.command)}`
    );
    lines.push(`  ${result.recommendedNextAction.primary.reason}`);
  }

  if (result.nextSteps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of result.nextSteps) {
      lines.push(`  ${formatHumanCommand(step)}`);
    }
  }

  return lines.join("\n");
}

function formatNextAction(action: RecommendedNextAction): string {
  if (!action.primary) {
    return "No recommended next action. Switchboard did not find a concrete setup step.";
  }

  const lines = [
    "Recommended next:",
    `  ${formatHumanCommand(action.primary.command)}`,
    `  ${action.primary.reason}`
  ];

  if (action.alternatives.length > 0) {
    lines.push(
      "",
      "Alternatives:",
      ...action.alternatives.map(
        (item) => `  ${formatHumanCommand(item.command)} - ${item.reason}`
      )
    );
  }

  return lines.join("\n");
}

function formatBypassFindingLine(finding: BypassFinding): string {
  const provider =
    finding.provider === "unknown" ? "provider unknown" : finding.provider;
  const tags = finding.riskTags.join(", ");
  return `  ${finding.severity} ${finding.client}:${finding.serverName} (${provider}; ${tags})`;
}

function formatDoctorStatus(
  status: "ok" | "setup-incomplete" | "failed"
): string {
  if (status === "setup-incomplete") {
    return "setup incomplete";
  }
  return status === "ok" ? "OK" : "failed";
}

function formatDoctorReadinessLine(
  status: "ok" | "setup-incomplete" | "failed"
): string {
  if (status === "ok") {
    return "Ready: config, local tokens, and installed agent clients look usable.";
  }

  if (status === "setup-incomplete") {
    return "Almost ready: config is valid, but one or more setup steps remain.";
  }

  return "Blocked: fix the failing checks below before giving an agent this repo.";
}

function formatClientConfigStatus(
  status: ProjectClientConfigInspection["status"]
): string {
  if (status === "installed") {
    return "installed";
  }

  if (status === "missing") {
    return "not installed";
  }

  return status;
}

function clientConfigSummary(configs: ProjectClientConfigInspection[]): string {
  const installed = configs.filter((item) => item.status === "installed").length;
  const invalid = configs.filter((item) => item.status === "invalid").length;

  if (invalid > 0) {
    return `${invalid} project client config file(s) could not be inspected.`;
  }

  return `${installed}/${configs.length} project client config(s) route through switchboard mcp.`;
}

function secretCheckSummary(missingSecrets: MissingSecretRef[]): string {
  if (missingSecrets.length === 0) {
    return "Configured local tokens are available.";
  }

  return `${missingSecrets.length} configured local token(s) are missing or unavailable.`;
}

function bypassCheckSummary(findings: BypassFinding[]): string {
  if (findings.length === 0) {
    return "No direct Codex/Claude MCP bypass routes were detected.";
  }

  const high = findings.filter((finding) => finding.severity === "high").length;
  return high > 0
    ? `${findings.length} direct MCP bypass route(s) detected, including ${high} high-risk route(s).`
    : `${findings.length} direct MCP bypass route(s) detected.`;
}

function formatProviderAddPlanJson(plan: ProviderAddPlan): Record<string, unknown> {
  return {
    ok: true,
    schemaVersion: providerAddSchemaVersion,
    action: plan.exists ? "update-planned" : "create-planned",
    targetPath: plan.targetPath,
    presetId: plan.id,
    provider: plan.rendered.template.provider,
    profileName: plan.rendered.profileName,
    namespace: plan.rendered.namespace,
    secretRef: plan.rendered.secretRef,
    command: plan.rendered.command,
    args: plan.rendered.args,
    configYaml: plan.nextContent,
    secretCommands: plan.secretCommands,
    checkCommand: plan.checkCommand,
    installCommands: plan.installCommands,
    mandateCommand: plan.mandateCommand,
    mandatePolicy: renderedProviderMandatePolicy(plan.rendered),
    commands: formatProviderAddCommands(plan),
    credentialGuidance: plan.rendered.credentialGuidance,
    notes: plan.rendered.notes
  };
}

function formatProviderAddCommands(plan: ProviderAddPlan): Record<string, unknown> {
  return {
    setup: {
      command: "switchboard",
      args: [
        "setup",
        plan.id,
        ...(plan.rendered.secretRef === plan.rendered.template.defaultSecretRef
          ? []
          : ["--secret-ref", plan.rendered.secretRef])
      ]
    },
    auth: {
      command: "switchboard",
      args: [
        "auth",
        plan.id,
        ...(plan.rendered.secretRef === plan.rendered.template.defaultSecretRef
          ? []
          : ["--secret-ref", plan.rendered.secretRef])
      ]
    },
    secrets: plan.secretCommands.map((command) => ({
      command: "switchboard",
      args: command.split(" ").slice(1)
    })),
    presetCheck: {
      command: "switchboard",
      args: [
        "presets",
        "check",
        plan.id,
        "--profile",
        plan.rendered.profileName
      ]
    },
    installs: [
      { command: "switchboard", args: ["install", "codex", "--write"] },
      { command: "switchboard", args: ["install", "claude", "--write"] }
    ],
    mandateCreate: {
      command: "switchboard",
      args: [
        "mandate",
        "create",
        plan.rendered.template.recommendedMandate.task,
        "--from",
        plan.id,
        "--profiles",
        plan.rendered.profileName
      ]
    }
  };
}

function formatProviderAddWriteJson(
  result: WrittenProviderAddPlan
): Record<string, unknown> {
  return {
    ...formatProviderAddPlanJson(result.plan),
    action: result.action,
    backupPath: result.backupPath
  };
}

function formatProviderAddPlan(plan: ProviderAddPlan): string {
  return formatProviderAdd(plan, {
    heading: "Switchboard add plan",
    action: plan.exists ? "update .switchboard.yaml" : "create .switchboard.yaml",
    backupPath: null,
    written: false
  });
}

function formatProviderAddWrite(result: WrittenProviderAddPlan): string {
  return formatProviderAdd(result.plan, {
    heading: "Switchboard provider setup written",
    action: result.action,
    backupPath: result.backupPath,
    written: true
  });
}

function formatProviderAdd(
  plan: ProviderAddPlan,
  options: {
    heading: string;
    action: string;
    backupPath: string | null;
    written: boolean;
  }
): string {
  return [
    options.heading,
    `Preset: ${plan.id} (${plan.rendered.template.label})`,
    `Target: ${plan.targetPath}`,
    `Action: ${options.action}`,
    ...(options.backupPath ? [`Backup: ${options.backupPath}`] : []),
    `Profile: ${plan.rendered.profileName}`,
    `Namespace: ${plan.rendered.namespace}`,
    `Token storage: local token alias ${plan.rendered.secretRef}`,
    `Command: ${plan.rendered.command}`,
    ...(plan.rendered.args.length > 0
      ? [`Args: ${plan.rendered.args.join(" ")}`]
      : []),
    "",
    "What this prepares:",
    ...formatProviderAddSummary(plan).map((line) => `  ${line}`),
    "",
    ...formatCredentialGuidance(plan.rendered.credentialGuidance),
    "",
    "Config preview:",
    plan.nextContent.trimEnd(),
    "",
    "Next steps:",
    ...formatProviderAddNextSteps(plan).map(
      (command) => `  ${formatHumanCommand(command)}`
    ),
    "",
    "Notes:",
    ...plan.rendered.notes.map((note) => `  ${note}`),
    ...(options.written
      ? []
      : ["", "Dry run by default. Re-run with --write to apply this plan."])
  ].join("\n");
}

function formatProviderAddNextSteps(plan: ProviderAddPlan): string[] {
  const prefix = switchboardCommandPrefixForRepo(dirname(plan.targetPath));
  return [
    providerAuthCommand(plan),
    plan.checkCommand,
    ...plan.installCommands,
    plan.mandateCommand
  ].map((command) => rewriteSwitchboardCommand(command, prefix));
}

function providerAuthCommand(plan: ProviderAddPlan): string {
  const base = `switchboard auth ${plan.id}`;
  return plan.rendered.secretRef === plan.rendered.template.defaultSecretRef
    ? base
    : `${base} --secret-ref ${shellQuoteCommandArg(plan.rendered.secretRef)}`;
}

function repoAwarePresetDefaults(
  presetId: string,
  cwd: string
): { profileName: string; namespace: string; secretRef: string } {
  const repoName = safeIdentifierForCommand(basename(cwd));
  if (presetId === "github-ci") {
    const profileName = `github_${repoName}_ci`;
    return {
      profileName,
      namespace: profileName,
      secretRef: `github/${repoName}/dev/token`
    };
  }
  if (presetId === "vercel-preview") {
    const profileName = `vercel_${repoName}_preview`;
    return {
      profileName,
      namespace: profileName,
      secretRef: `vercel/${repoName}/preview/token`
    };
  }
  if (presetId === "stripe-test") {
    const profileName = `stripe_${repoName}_test`;
    return {
      profileName,
      namespace: profileName,
      secretRef: `stripe/${repoName}/test/secret-key`
    };
  }

  const template = getProviderSafetyTemplate(presetId);
  return {
    profileName: template?.defaultProfileName ?? safeIdentifierForCommand(presetId),
    namespace: template?.defaultNamespace ?? safeIdentifierForCommand(presetId),
    secretRef: template?.defaultSecretRef ?? `${safeIdentifierForCommand(presetId)}/${repoName}/dev/token`
  };
}

function safeIdentifierForCommand(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "repo";
}

function formatProviderAuth(result: {
  label: string;
  secretEnvName: string;
  ref: string;
  nextSteps: string[];
}): string {
  return [
    `Stored ${result.label} token`,
    `For: ${result.secretEnvName}`,
    `Stored locally as: ${result.ref}`,
    "",
    "Next steps:",
    ...result.nextSteps.map((step) => `  ${formatHumanCommand(step)}`)
  ].join("\n");
}

function providerSetupNextSteps(plan: ProviderAddPlan): string[] {
  return [
    "switchboard doctor",
    plan.checkCommand,
    ...plan.installCommands,
    plan.mandateCommand
  ];
}

function formatProviderSetup(result: {
  label: string;
  targetPath: string;
  configAction: string;
  backupPath: string | null;
  profileName: string;
  namespace: string;
  secretRef: string;
  nextSteps: string[];
}): string {
  return [
    `Switchboard ${result.label} setup complete`,
    "Ready: profile created and provider token stored locally.",
    `Config: ${result.configAction} ${result.targetPath}`,
    ...(result.backupPath ? [`Backup: ${result.backupPath}`] : []),
    `Profile: ${result.profileName}`,
    `Namespace: ${result.namespace}`,
    `Token: stored locally for ${result.label}`,
    `Token alias: ${result.secretRef}`,
    "",
    "Next steps:",
    ...result.nextSteps.map((step) => `  ${formatHumanCommand(step)}`)
  ].join("\n");
}

function formatHumanCommand(command: string): string {
  if (!isSourceCheckoutEntrypoint()) {
    return command;
  }

  if (command === "switchboard") {
    return "pnpm switchboard";
  }

  return command.startsWith("switchboard ")
    ? `pnpm switchboard ${command.slice("switchboard ".length)}`
    : command;
}

function isSourceCheckoutEntrypoint(): boolean {
  return (
    process.env.npm_package_name === "switchboard" &&
    process.env.npm_lifecycle_event === "switchboard"
  );
}

function formatProviderAddSummary(plan: ProviderAddPlan): string[] {
  const policy = providerSafetyTemplatePolicy(
    plan.id,
    plan.rendered.namespace
  );
  return [
    `one ${plan.rendered.template.provider} MCP profile: ${plan.rendered.profileName}`,
    `one local token alias for ${plan.rendered.template.secretEnvName}: ${plan.rendered.secretRef}`,
    `agent clients route through Switchboard after install`,
    `mandate policy: ${policy.allowedTools?.length ?? 0} allow pattern(s), ${policy.approvalGates?.length ?? 0} approval gate(s), ${policy.deniedTools?.length ?? 0} deny pattern(s)`,
    `mandate command binds authority to the current repo, branch, and ${plan.rendered.template.recommendedMandate.lease} lease`
  ];
}

function formatProviderPresetList(result: {
  count: number;
  templates: Array<{
    id: string;
    provider: string;
    label: string;
    description: string;
    defaultProfileName: string;
    defaultNamespace: string;
    defaultSecretRef: string;
    mode: string;
    readOnly: boolean;
  }>;
}): string {
  const lines = [
    "Switchboard provider safety templates",
    `Templates: ${result.count}`
  ];

  for (const template of result.templates) {
    lines.push(
      "",
      `${template.id} (${template.label})`,
      `  Provider: ${template.provider}`,
      `  Default profile: ${template.defaultProfileName}`,
      `  Default namespace: ${template.defaultNamespace}`,
      `  Default secretRef: ${template.defaultSecretRef}`,
      `  Mode: ${template.mode}${template.readOnly ? " read-only" : ""}`,
      `  ${template.description}`,
      `  Show: switchboard presets show ${template.id}`
    );
  }

  return lines.join("\n");
}

function formatProviderPresetShow(
  rendered: RenderedProviderSafetyTemplate
): string {
  return [
    `Switchboard provider safety template: ${rendered.template.label}`,
    `Provider: ${rendered.template.provider}`,
    `Profile: ${rendered.profileName}`,
    `Namespace: ${rendered.namespace}`,
    `secretRef: ${rendered.secretRef}`,
    ...(rendered.args.length > 0 ? [`Args: ${rendered.args.join(" ")}`] : []),
    "",
    "Config YAML:",
    rendered.configYaml.trimEnd(),
    "",
    "Secret setup:",
    ...rendered.secretCommands.map((command) => `  ${command}`),
    "",
    "Recommended mandate:",
    `  ${rendered.mandateCommand}`,
    "",
    ...formatRenderedProviderMandatePolicy(rendered),
    "",
    ...formatCredentialGuidance(rendered.credentialGuidance),
    "",
    "Notes:",
    ...rendered.notes.map((note) => `  ${note}`),
    "",
    "This template does not install, authenticate, or vendor a provider MCP server."
  ].join("\n");
}

function renderedProviderMandatePolicy(
  rendered: RenderedProviderSafetyTemplate
): MandateToolPolicy {
  return providerSafetyTemplatePolicy(
    rendered.template.id,
    rendered.namespace
  );
}

function formatRenderedProviderMandatePolicy(
  rendered: RenderedProviderSafetyTemplate
): string[] {
  const policy = renderedProviderMandatePolicy(rendered);
  return [
    "Rendered mandate policy:",
    `  Allowed tools: ${policy.allowedTools?.join(", ") ?? "all"}`,
    `  Denied tools: ${policy.deniedTools?.join(", ") ?? "none"}`,
    "  Approval gates:",
    ...(policy.approvalGates && policy.approvalGates.length > 0
      ? policy.approvalGates.map(
          (gate) =>
            `    - ${gate.toolPattern} (${[
              gate.risk ? `risk:${gate.risk}` : undefined,
              gate.labels && gate.labels.length > 0
                ? `labels:${gate.labels.join("+")}`
                : undefined,
              gate.reason ? `reason:${gate.reason}` : undefined
            ]
              .filter(Boolean)
              .join(" ")})`
        )
      : ["    - none"])
  ];
}

function formatCredentialGuidance(
  guidance: RenderedProviderSafetyTemplate["credentialGuidance"]
): string[] {
  return [
    "Credential guidance:",
    `  Posture: ${guidance.posture}`,
    "  Minimum access:",
    ...guidance.minimumScopes.map((scope) => `    - ${scope}`),
    "  Add only when approval-gated:",
    ...guidance.approvalScopes.map((scope) => `    - ${scope}`),
    "  Avoid:",
    ...guidance.avoidScopes.map((scope) => `    - ${scope}`),
    "  Notes:",
    ...guidance.notes.map((note) => `    - ${note}`)
  ];
}

function formatProviderPresetCheck(result: {
  ok: boolean;
  presetId: string;
  provider: string;
  profileName: string;
  namespace: string;
  policyCovered: boolean;
  requiresMandatePolicy: boolean;
  counts: {
    tools: number;
    allowed: number;
    allowedSensitive: number;
    approvalRequired: number;
    denied: number;
    notAllowed: number;
  };
  tools: Array<{
    toolName: string;
    classification:
      | "allowed"
      | "allowed_sensitive"
      | "approval_required"
      | "denied"
      | "not_allowed";
    reason: string;
    approvalGateId?: string;
    approvalGatePattern?: string;
  }>;
  nextActions: string[];
}): string {
  const lines = [
    result.policyCovered
      ? "Switchboard provider preset check: policy-covered"
      : "Switchboard provider preset check: needs attention",
    `Preset: ${result.presetId} (${result.provider})`,
    `Profile: ${result.profileName}`,
    `Namespace: ${result.namespace}`,
    `Requires mandate policy: ${result.requiresMandatePolicy ? "yes" : "no"}`,
    `Tools: ${result.counts.tools}`,
    `Allowed: ${result.counts.allowed}`,
    `Allowed sensitive: ${result.counts.allowedSensitive}`,
    `Approval required: ${result.counts.approvalRequired}`,
    `Denied: ${result.counts.denied}`,
    `Not allowed: ${result.counts.notAllowed}`
  ];

  const notableTools = result.tools.filter(
    (tool) => tool.classification !== "allowed"
  );
  if (notableTools.length > 0) {
    lines.push("", "Notable tools:");
    for (const tool of notableTools) {
      lines.push(`  ${tool.toolName} - ${tool.classification}`);
      if (tool.approvalGateId) {
        lines.push(`    gate: ${tool.approvalGateId} (${tool.approvalGatePattern})`);
      }
      lines.push(`    ${tool.reason}`);
    }
  }

  if (result.nextActions.length > 0) {
    lines.push("", "Next actions:");
    for (const action of result.nextActions) {
      lines.push(`  ${action}`);
    }
  }

  return lines.join("\n");
}

function formatSecretsList(result: {
  indexPath: string;
  count: number;
  refs: Array<{ ref: string; updatedAt: string }>;
}): string {
  const lines = ["Switchboard secrets", `Index: ${result.indexPath}`];
  if (result.count === 0) {
    lines.push("No secret refs are indexed.");
    return lines.join("\n");
  }

  lines.push("", "Refs:");
  for (const entry of result.refs) {
    lines.push(`  ${entry.ref} (updated ${entry.updatedAt})`);
  }
  return lines.join("\n");
}

function formatSecretsDoctor(result: {
  ok: boolean;
  indexPath: string;
  backend?: Record<string, unknown>;
  diagnostics: Array<{ level: string; message: string }>;
  usages: ReturnType<typeof collectSecretRefUsages>;
  missing: MissingSecretRef[];
}): string {
  const lines = [
    result.ok ? "Switchboard secrets doctor: OK" : "Switchboard secrets doctor: failed",
    `Index: ${result.indexPath}`
  ];

  if (result.backend) {
    lines.push(`Backend: ${formatSecretBackendDiagnostic(result.backend)}`);
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.level}: ${diagnostic.message}`);
  }

  if (result.usages.length === 0) {
    lines.push("No configured secretRefs.");
    return lines.join("\n");
  }

  lines.push("", "Configured secretRefs:");
  for (const usage of result.usages) {
    const missing = result.missing.find((item) => item.ref === usage.ref);
    lines.push(
      `  ${usage.ref} - ${usage.profileName}.${usage.envName}${missing ? ` (${missing.status})` : ""}`
    );
  }

  if (result.missing.length > 0) {
    lines.push("", "Next steps:");
    for (const missing of result.missing) {
      lines.push(`  switchboard secrets set ${missing.ref} --value-stdin`);
    }
  }

  return lines.join("\n");
}

async function diagnoseSecretStore(
  store: SecretStore
): Promise<Record<string, unknown>> {
  if (!store.diagnose) {
    return { ok: true, backend: "unknown" };
  }

  try {
    return await store.diagnose();
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

function formatSecretBackendDiagnostic(
  diagnostic: Record<string, unknown>
): string {
  if (typeof diagnostic.error === "string") {
    return `error (${diagnostic.error})`;
  }

  if (diagnostic.ok === false && typeof diagnostic.message === "string") {
    return `error (${diagnostic.message})`;
  }

  if (
    typeof diagnostic.backend === "object" &&
    diagnostic.backend !== null &&
    "id" in diagnostic.backend &&
    typeof diagnostic.backend.id === "string"
  ) {
    return diagnostic.backend.id;
  }

  if (typeof diagnostic.backend === "string") {
    return diagnostic.backend;
  }

  return "unknown";
}

function isSecretBackendDiagnosticOk(
  diagnostic: Record<string, unknown>
): boolean {
  return (
    diagnostic.ok !== false &&
    typeof diagnostic.error !== "string" &&
    typeof diagnostic.message !== "string"
  );
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
}, repoPath?: string): string {
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

  if (result.mandate && repoPath) {
    const commandPrefix = `switchboard --cwd ${shellQuote(repoPath)}`;
    lines.push(
      "",
      "Next commands:",
      `  ${commandPrefix} mcp --mandate ${result.mandate.id}`,
      `  ${commandPrefix} approvals --mandate ${result.mandate.id} --json`,
      `  ${commandPrefix} logs --mandate ${result.mandate.id} --json`,
      `  ${commandPrefix} mandate handoff ${result.mandate.id} --state completed --summary <summary>`
    );
  }

  return lines.join("\n");
}

function formatDemoMandate(options: {
  cwd: string;
  task: string;
  mandateId: string;
  agent: string;
  branch: string;
  lease: string;
  profileName: string;
  namespace: string;
  approvalTool: string;
  approvalReason: string;
  approvalRisk: string;
  approvalLabels: string[];
}): string {
  const commandPrefix = `switchboard --cwd ${shellQuote(options.cwd)}`;
  const sourcePrefix = `pnpm --filter @switchboard-mcp/cli switchboard --cwd ${shellQuote(options.cwd)}`;
  const approvalLabels = options.approvalLabels.flatMap((label) => [
    "--require-approval-label",
    shellQuote(label)
  ]);
  const createArgs = [
    "mandate",
    "create",
    shellQuote(options.task),
    "--agent",
    shellQuote(options.agent),
    "--profiles",
    shellQuote(options.profileName),
    "--branch",
    shellQuote(options.branch),
    "--lease",
    shellQuote(options.lease),
    "--allow-tool",
    shellQuote(`${options.namespace}_*`),
    "--require-approval-tool",
    shellQuote(options.approvalTool),
    "--require-approval-reason",
    shellQuote(options.approvalReason),
    "--require-approval-risk",
    shellQuote(options.approvalRisk),
    ...approvalLabels
  ];

  return [
    "Switchboard mandate demo",
    `Repo: ${options.cwd}`,
    `Profile: ${options.profileName}`,
    `Namespace: ${options.namespace}`,
    `Task: ${options.task}`,
    `Mandate id: ${options.mandateId}`,
    "",
    "Installed CLI commands:",
    `  ${commandPrefix} ${createArgs.join(" ")}`,
    `  ${commandPrefix} tools --mandate ${options.mandateId}`,
    `  ${commandPrefix} tools --mandate ${options.mandateId} --json`,
    `  ${commandPrefix} mcp --mandate ${options.mandateId}`,
    `  ${commandPrefix} approvals --mandate ${options.mandateId}`,
    `  ${commandPrefix} logs --mandate ${options.mandateId}`,
    `  ${commandPrefix} mandate handoff ${options.mandateId} --state completed --summary ${shellQuote("Demo finished")} --by human-demo`,
    `  ${commandPrefix} mandate report ${options.mandateId} --json`,
    "",
    "Source checkout prefix:",
    `  ${sourcePrefix}`,
    "Replace the installed CLI prefix in the commands above with this prefix when dogfooding from a source checkout.",
    "",
    "For the automated MCP approval path:",
    "  pnpm smoke:mandate-walkthrough",
    "",
    "No provider accounts, secrets, keychains, or remote services are used."
  ].join("\n");
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellQuoteCommandArg(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : shellQuote(value);
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function shortPath(path: string): string {
  const cwd = resolve(process.cwd());
  const absolute = resolve(path);
  if (absolute === cwd) {
    return ".";
  }
  if (absolute.startsWith(`${cwd}${sep}`)) {
    return absolute.slice(cwd.length + 1);
  }
  return path;
}

function currentGitBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

function formatMandateCreated(path: string, mandate: MandateWithStatus): string {
  const commandPrefix = `switchboard --cwd ${shellQuote(mandate.repoPath)}`;
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
    `Store: ${path}`,
    "",
    "Next commands:",
    `  ${commandPrefix} tools --mandate ${mandate.id}`,
    `  ${commandPrefix} mcp --mandate ${mandate.id}`,
    `  ${commandPrefix} approvals --mandate ${mandate.id} --json`,
    `  ${commandPrefix} logs --mandate ${mandate.id} --json`,
    `  ${commandPrefix} mandate handoff ${mandate.id} --state completed --summary <summary>`
  ].join("\n");
}

function createMandateMcpLaunchPayload(
  mandate: MandateWithStatus
): MandateMcpLaunchPayload {
  const args = ["--cwd", mandate.repoPath, "mcp", "--mandate", mandate.id];
  const env = createLaunchEnv();
  const runtimeDir = env.SWITCHBOARD_RUNTIME_DIR ?? null;
  return {
    schemaVersion: mandateMcpLaunchSchemaVersion,
    transport: "stdio",
    mandateId: mandate.id,
    cwd: mandate.repoPath,
    runtimeDir,
    env,
    approvalWaitMs: 0,
    daemonIsolation: runtimeDir ? "repo-runtime-dir" : "default",
    command: "switchboard",
    args,
    commandCandidates: createMandateMcpLaunchCommandCandidates(args),
    commands: createMandateMcpLaunchCommands(mandate),
    policy: {
      profiles: mandate.profiles,
      allowedTools: mandate.allowedTools,
      deniedTools: mandate.deniedTools,
      approvalGates: mandate.approvalGates.map((gate) => ({
        id: gate.id,
        toolPattern: gate.toolPattern,
        ...(gate.reason ? { reason: gate.reason } : {}),
        ...(gate.risk ? { risk: gate.risk } : {}),
        ...(gate.labels && gate.labels.length > 0 ? { labels: gate.labels } : {})
      }))
    },
    installHint:
      "Use command/args when the switchboard binary is on PATH. If it is not, use a commandCandidates entry such as current-entrypoint."
  };
}

function createWorkspaceLeasePayload(
  mandate: MandateWithStatus,
  mcpLaunch: MandateMcpLaunchPayload = createMandateMcpLaunchPayload(mandate)
): WorkspaceLeasePayload {
  return {
    schemaVersion: workspaceLeaseSchemaVersion,
    mandateId: mandate.id,
    mandateUid: mandate.mandateUid ?? null,
    repo: {
      path: mandate.repoPath,
      worktreePath: mandate.worktreePath,
      branch: mandate.branch
    },
    runtime: {
      kind: "local",
      transport: "stdio"
    },
    envClass: envClassFromMandate(mandate),
    authority: {
      agentRole: mandate.agentRole,
      profiles: mandate.profiles,
      allowedTools: mandate.allowedTools,
      deniedTools: mandate.deniedTools,
      approvalGates: mcpLaunch.policy.approvalGates,
      ...(mandate.parentMandateId
        ? { parentMandateId: mandate.parentMandateId }
        : {}),
      ...(mandate.parentMandateUid
        ? { parentMandateUid: mandate.parentMandateUid }
        : {})
    },
    lease: {
      createdAt: mandate.createdAt,
      expiresAt: mandate.expiresAt,
      status: mandate.runtimeStatus
    },
    mcpLaunch,
    runLaunch: createWorkspaceLeaseRunLaunch(mandate, mcpLaunch.env),
    capabilities: {
      mcpLaunchEnv: true,
      runLaunch: true,
      structuredMcpErrors: true,
      daemonRuntimeDir: Boolean(mcpLaunch.runtimeDir)
    },
    commands: mcpLaunch.commands,
    limits: [
      "local authority contract only; this is not a sandbox",
      "tool access requires launching through the included mcpLaunch command",
      "authority expires at lease.expiresAt"
    ]
  };
}

function createWorkspaceLeaseRunLaunch(
  mandate: MandateWithStatus,
  env: Record<string, string>
): WorkspaceLeaseRunLaunch {
  return {
    schemaVersion: "switchboard.run-launch.v1",
    command: "switchboard",
    args: ["--cwd", mandate.repoPath, "run", "--mandate", mandate.id, "--"],
    env,
    note:
      "Append the provider CLI command after --. Run mode scopes mounted profile credentials and audits execution; it is not a filesystem or network sandbox."
  };
}

function createLaunchEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "SWITCHBOARD_RUNTIME_DIR",
    "XDG_STATE_HOME",
    "XDG_CONFIG_HOME"
  ]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

function envClassFromMandate(
  mandate: MandateWithStatus
): WorkspaceLeasePayload["envClass"] {
  const text = [
    mandate.id,
    mandate.task,
    mandate.branch,
    ...mandate.profiles,
    ...mandate.allowedTools
  ].join(" ");
  if (/(^|[_\-.])(prod|production|live)([_\-.]|$)/i.test(text)) {
    return "prod";
  }
  if (/(^|[_\-.])(dev|development|local|test|preview|staging|ci)([_\-.]|$)/i.test(text)) {
    return "non-prod";
  }
  return "unknown";
}

function createMandateMcpLaunchCommands(
  mandate: MandateWithStatus
): MandateMcpLaunchCommands {
  const cwdArgs = ["--cwd", mandate.repoPath];
  return {
    mcp: {
      command: "switchboard",
      args: [...cwdArgs, "mcp", "--mandate", mandate.id]
    },
    toolSurface: {
      command: "switchboard",
      args: [...cwdArgs, "tools", "--mandate", mandate.id, "--json"]
    },
    approvals: {
      command: "switchboard",
      args: [
        ...cwdArgs,
        "approvals",
        "--mandate",
        mandate.id,
        "--include-children",
        "--json"
      ]
    },
    status: {
      command: "switchboard",
      args: [...cwdArgs, "mandate", "status", mandate.id, "--json"]
    },
    report: {
      command: "switchboard",
      args: [...cwdArgs, "mandate", "report", mandate.id, "--json"]
    },
    logs: {
      command: "switchboard",
      args: [...cwdArgs, "logs", "--mandate", mandate.id, "--json"]
    },
    escalation: {
      command: "switchboard",
      args: [...cwdArgs, "mandate", "escalate", mandate.id, "--json"]
    },
    childTemplate: {
      command: "switchboard",
      args: [
        ...cwdArgs,
        "mandate",
        "child",
        "<child-id>",
        "--parent",
        mandate.id,
        "--agent",
        "<role>",
        "--profiles",
        mandate.profiles.join(","),
        "--branch",
        mandate.branch,
        "--lease",
        "<duration>",
        "--json"
      ]
    }
  };
}

function createMandateMcpLaunchCommandCandidates(
  args: string[]
): MandateMcpLaunchCommandCandidate[] {
  return [
    {
      kind: "path",
      command: "switchboard",
      args,
      description:
        "Use when the switchboard binary is installed and available on PATH."
    },
    currentCliEntrypointCandidate(args)
  ];
}

function currentCliEntrypointCandidate(
  args: string[]
): MandateMcpLaunchCommandCandidate {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  if (moduleDir.endsWith(`${sep}src`)) {
    const packageDir = dirname(moduleDir);
    return {
      kind: "source-entrypoint",
      command: "pnpm",
      args: [
        "--dir",
        packageDir,
        "exec",
        "tsx",
        "--conditions",
        "source",
        "src/index.ts",
        ...args
      ],
      description:
        "Use when launching from a Switchboard source checkout before build; requires pnpm install."
    };
  }

  return {
    kind: "current-entrypoint",
    command: process.execPath,
    args: [resolve(moduleDir, "index.js"), ...args],
    description:
      "Use when launching from the current built Switchboard package and switchboard is not on PATH."
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
  config?: ReturnType<typeof loadSwitchboardConfig>["config"];
  secretStore?: SecretStore;
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
      ...(options.repoPath ? { repoPath: options.repoPath } : {})
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
  const missingSecretRefs =
    options.config && options.secretStore
      ? await findMissingSecretRefs(
          {
            ...options.config,
            profiles: profilesForMandateChain(options.config.profiles, chain)
          },
          options.secretStore
        )
      : [];
  const readiness = mandateReportReadiness({
    selected,
    chain,
    approvalRequests,
    missingSecretRefs
  });
  const results = mandateReportResults(chain);

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
    readiness,
    results,
    childrenByParent: childrenByParent(chain),
    mandates: chain,
    approvalRequests,
    auditEntries: limitedAuditEntries
  };
}

function mandateReportReadiness(options: {
  selected: MandateWithStatus;
  chain: MandateWithStatus[];
  approvalRequests: ApprovalRequestWithStatus[];
  missingSecretRefs: MissingSecretRef[];
}): MandateReportReadiness {
  const selectedSubtree = options.chain.filter((mandate) =>
    mandateInSelectedSubtree(mandate, options.selected)
  );
  const selectedSubtreeIds = new Set(
    selectedSubtree.map((mandate) => mandate.id)
  );
  const selectedSubtreeUids = new Set(
    selectedSubtree.flatMap((mandate) =>
      mandate.mandateUid ? [mandate.mandateUid] : []
    )
  );
  const openChildMandates = selectedSubtree
    .filter(
      (mandate) =>
        !sameMandateInstance(mandate, options.selected) &&
        mandate.handoffState === "open"
    )
    .map((mandate) => ({
      id: mandate.id,
      mandateUid: mandate.mandateUid ?? null,
      agentRole: mandate.agentRole,
      branch: mandate.branch
    }));
  const pendingApprovalRequests = options.approvalRequests
    .filter((request) => request.runtimeStatus === "pending")
    .filter((request) => {
      if (!selectedSubtreeIds.has(request.mandateId)) {
        return false;
      }
      if (selectedSubtreeUids.size > 0) {
        return request.mandateUid
          ? selectedSubtreeUids.has(request.mandateUid)
          : false;
      }
      return true;
    })
    .map((request) => ({
      id: request.id,
      mandateId: request.mandateId,
      mandateUid: request.mandateUid ?? null,
      toolName: request.toolName,
      approvalGateId: request.approvalGateId
    }));
  const selectedProfileNames = new Set(
    selectedSubtree.flatMap((mandate) => mandate.profiles)
  );
  const missingSecretRefs = options.missingSecretRefs
    .map((missing) => {
      const usages = missing.usages.filter((usage) =>
        selectedProfileNames.has(usage.profileName)
      );
      if (usages.length === 0) {
        return null;
      }

      return {
        ref: missing.ref,
        profiles: uniqueStrings(usages.map((usage) => usage.profileName)),
        envNames: uniqueStrings(usages.map((usage) => usage.envName)),
        status: missing.status,
        message: missing.message
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const blockers = [
    ...(options.selected.handoffState !== "open"
      ? [`selected mandate is already ${options.selected.handoffState}`]
      : []),
    ...openChildMandates.map(
      (mandate) => `child mandate "${mandate.id}" remains open`
    ),
    ...pendingApprovalRequests.map(
      (request) => `approval request "${request.id}" is pending`
    ),
    ...missingSecretRefs.map(
      (missing) => `secretRef "${missing.ref}" is ${missing.status}`
    )
  ];
  const nextActions = [
    ...openChildMandates.map(
      (mandate) =>
        `switchboard mandate handoff ${mandate.id} --state completed --summary <summary>`
    ),
    ...pendingApprovalRequests.map(
      (request) =>
        `switchboard approve ${request.id} or switchboard deny ${request.id}`
    ),
    ...missingSecretRefs.map(
      (missing) => `switchboard secrets set ${missing.ref} --value-stdin`
    )
  ];

  return {
    selectedCanHandoff: blockers.length === 0,
    selectedHandoffState: options.selected.handoffState,
    openChildMandates,
    pendingApprovalRequests,
    missingSecretRefs,
    blockers,
    nextActions
  };
}

function mandateReportResults(chain: MandateWithStatus[]): MandateReportResults {
  const handoffs = chain
    .filter((mandate) => mandate.handoffState !== "open")
    .map((mandate) => ({
      id: mandate.id,
      mandateUid: mandate.mandateUid ?? null,
      parentMandateId: mandate.parentMandateId ?? null,
      state: mandate.handoffState as Exclude<
        MandateWithStatus["handoffState"],
        "open"
      >,
      agentRole: mandate.agentRole,
      branch: mandate.branch,
      summary: mandate.handoffSummary ?? null,
      nextSteps: mandate.handoffNextSteps ?? [],
      artifacts: mandate.handoffArtifacts ?? [],
      by: mandate.handoffBy ?? null,
      at: mandate.handoffAt ?? null
    }));
  const openMandates = chain
    .filter((mandate) => mandate.handoffState === "open")
    .map((mandate) => ({
      id: mandate.id,
      mandateUid: mandate.mandateUid ?? null,
      agentRole: mandate.agentRole,
      branch: mandate.branch
    }));
  const nextSteps = handoffs.flatMap((handoff) =>
    handoff.nextSteps.map((value) => ({
      mandateId: handoff.id,
      mandateUid: handoff.mandateUid,
      value
    }))
  );
  const artifacts = handoffs.flatMap((handoff) =>
    handoff.artifacts.map((value) => ({
      mandateId: handoff.id,
      mandateUid: handoff.mandateUid,
      value
    }))
  );

  return {
    counts: {
      handoffs: handoffs.length,
      completed: handoffs.filter((handoff) => handoff.state === "completed")
        .length,
      blocked: handoffs.filter((handoff) => handoff.state === "blocked")
        .length,
      cancelled: handoffs.filter((handoff) => handoff.state === "cancelled")
        .length,
      open: openMandates.length,
      summaries: handoffs.filter((handoff) => handoff.summary).length,
      nextSteps: nextSteps.length,
      artifacts: artifacts.length
    },
    handoffs,
    openMandates,
    nextSteps,
    artifacts
  };
}

function createMandateEscalationPayload(
  report: MandateReportPayload
): MandateEscalationPayload {
  const approvalItems: MandateEscalationItem[] =
    report.readiness.pendingApprovalRequests.map((request) => ({
      type: "approval_request",
      priority: "decision",
      mandateId: request.mandateId,
      mandateUid: request.mandateUid,
      approvalRequestId: request.id,
      toolName: request.toolName,
      approvalGateId: request.approvalGateId,
      title: `Approval request ${request.id} is pending`,
      detail: `Tool ${request.toolName} is waiting on approval gate ${request.approvalGateId}.`,
      commands: [
        `switchboard approve ${request.id}`,
        `switchboard deny ${request.id}`
      ]
    }));
  const openChildItems: MandateEscalationItem[] =
    report.readiness.openChildMandates.map((mandate) => ({
      type: "open_child_mandate",
      priority: "handoff",
      mandateId: mandate.id,
      mandateUid: mandate.mandateUid,
      title: `Child mandate ${mandate.id} remains open`,
      detail: `Worker role ${mandate.agentRole} on branch ${mandate.branch} must hand off before the selected mandate can close.`,
      commands: [
        `switchboard mandate report ${mandate.id} --json`,
        `switchboard mandate handoff ${mandate.id} --state completed --summary <summary>`
      ]
    }));
  const missingSecretItems: MandateEscalationItem[] =
    report.readiness.missingSecretRefs.map((missing) => ({
      type: "missing_secret_ref",
      priority: "setup",
      mandateId: report.selectedMandateId,
      mandateUid: report.selectedMandateUid,
      title: `Secret ref ${missing.ref} is ${missing.status}`,
      detail: `Profiles ${missing.profiles.join(", ")} need ${missing.envNames.join(", ")} before this mandate can run.`,
      commands: [`switchboard secrets set ${missing.ref} --value-stdin`]
    }));
  const handoffItems: MandateEscalationItem[] = report.results.handoffs
    .filter(
      (handoff) =>
        handoff.state === "blocked" || handoff.state === "cancelled"
    )
    .map((handoff) => ({
      type:
        handoff.state === "blocked"
          ? "blocked_handoff"
          : "cancelled_handoff",
      priority: "review",
      mandateId: handoff.id,
      mandateUid: handoff.mandateUid,
      state: handoff.state,
      summary: handoff.summary,
      nextSteps: handoff.nextSteps,
      artifacts: handoff.artifacts,
      title: `Mandate ${handoff.id} is ${handoff.state}`,
      detail:
        handoff.summary ??
        `Mandate ${handoff.id} handed off with state ${handoff.state}.`,
      commands: [`switchboard mandate report ${handoff.id} --json`]
    }));
  const items = [
    ...approvalItems,
    ...openChildItems,
    ...missingSecretItems,
    ...handoffItems
  ];
  const nextCommands = uniqueStrings(items.flatMap((item) => item.commands));
  const copyText = formatMandateEscalationCopyText(report, items);

  return {
    schemaVersion: mandateEscalationSchemaVersion,
    reportSchemaVersion: mandateReportSchemaVersion,
    path: report.path,
    auditLogPath: report.auditLogPath,
    repoPath: report.repoPath,
    selectedMandateId: report.selectedMandateId,
    selectedMandateUid: report.selectedMandateUid,
    rootMandateId: report.rootMandateId,
    rootMandateUid: report.rootMandateUid,
    generatedAt: new Date().toISOString(),
    status: items.length === 0 ? "clear" : "needs_attention",
    counts: {
      items: items.length,
      approvalRequests: approvalItems.length,
      openChildMandates: openChildItems.length,
      missingSecretRefs: missingSecretItems.length,
      blockedHandoffs: handoffItems.filter(
        (item) => item.type === "blocked_handoff"
      ).length,
      cancelledHandoffs: handoffItems.filter(
        (item) => item.type === "cancelled_handoff"
      ).length
    },
    nextCommands,
    copyText,
    items
  };
}

function formatMandateEscalationCopyText(
  report: MandateReportPayload,
  items: MandateEscalationItem[]
): string {
  if (items.length === 0) {
    return `Switchboard mandate ${report.selectedMandateId} has no local escalation items.`;
  }

  return [
    `Switchboard escalation for mandate ${report.selectedMandateId}: ${items.length} item(s) need attention.`,
    ...items.map((item) => `- ${item.title}: ${item.detail}`),
    "Suggested local commands:",
    ...uniqueStrings(items.flatMap((item) => item.commands)).map(
      (command) => `- ${command}`
    )
  ].join("\n");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function profilesForMandateChain(
  profiles: ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"],
  mandates: MandateWithStatus[]
): ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"] {
  const allowedProfiles = new Set(mandates.flatMap((mandate) => mandate.profiles));
  return Object.fromEntries(
    Object.entries(profiles).filter(([profileName]) =>
      allowedProfiles.has(profileName)
    )
  ) as ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"];
}

function mandateInSelectedSubtree(
  mandate: MandateWithStatus,
  selected: MandateWithStatus
): boolean {
  if (sameMandateInstance(mandate, selected)) {
    return true;
  }
  const selectedUid = mandateUidForReport(selected);
  if (selectedUid) {
    return mandate.delegationUids?.includes(selectedUid) ?? false;
  }
  return mandate.delegationPath?.includes(selected.id) ?? false;
}

function sameMandateInstance(
  left: MandateWithStatus,
  right: MandateWithStatus
): boolean {
  const leftUid = mandateUidForReport(left);
  const rightUid = mandateUidForReport(right);
  if (leftUid && rightUid) {
    return leftUid === rightUid;
  }
  return left.id === right.id && left.createdAt === right.createdAt;
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
  mandateId?: string | null;
  includeChildren: boolean;
  status?: ApprovalRequestWithStatus["runtimeStatus"];
}): Promise<ApprovalRequestsPayload> {
  const selectedMandateId = options.mandateId
    ? normalizeMandateId(options.mandateId)
    : undefined;
  let allMandates: MandateWithStatus[] = [];
  let selectedMandate: MandateWithStatus | undefined;
  if (selectedMandateId) {
    allMandates = await listMandates({
      path: options.mandateStorePath,
      ...(options.repoPath ? { repoPath: options.repoPath } : {})
    });
    selectedMandate = findLatestMandate(allMandates, selectedMandateId);
  }

  const baseRequests = await listApprovalRequests({
    path: options.path,
    ...(options.repoPath ? { repoPath: options.repoPath } : {}),
    ...(options.includeChildren || !options.mandateId
      ? {}
      : { mandateId: selectedMandateId ?? options.mandateId }),
    ...(options.status ? { status: options.status } : {})
  });

  let mandates: MandateWithStatus[] = [];
  let rootMandateId: string | null = null;
  let rootMandateUid: string | null = null;
  let requests = baseRequests;
  const selectedMandateUid = selectedMandate
    ? mandateUidForReport(selectedMandate)
    : null;

  if (options.includeChildren) {
    if (!selectedMandateId) {
      throw new Error("mandate id is required");
    }
    if (!selectedMandate) {
      throw new Error(`mandate "${selectedMandateId}" was not found`);
    }
    rootMandateId = selectedMandate.delegationPath?.[0] ?? selectedMandate.id;
    rootMandateUid =
      selectedMandate.delegationUids?.[0] ?? selectedMandateUid;
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
  } else if (selectedMandateUid) {
    requests = baseRequests.filter(
      (request) => request.mandateUid === selectedMandateUid
    );
  }

  return {
    schemaVersion: approvalRequestsSchemaVersion,
    path: options.path,
    mandateStorePath: options.mandateId ? options.mandateStorePath : null,
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
  readiness?: MandateStatusReadiness;
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

  if (result.readiness && result.readiness.blockers.length > 0) {
    lines.push("", "Runtime blockers:");
    for (const blocker of result.readiness.blockers) {
      lines.push(`  ${blocker}`);
    }
  }

  if (result.readiness && result.readiness.warnings.length > 0) {
    lines.push("", "Runtime warnings:");
    for (const warning of result.readiness.warnings) {
      lines.push(`  ${warning}`);
    }
  }

  if (result.readiness && result.readiness.nextActions.length > 0) {
    lines.push("", "Next:");
    for (const action of result.readiness.nextActions) {
      lines.push(`  ${action}`);
    }
  }

  return lines.join("\n");
}

async function createMandateStatusReadiness(options: {
  mandates: MandateWithStatus[];
  repoPath: string | undefined;
  cwd: string | undefined;
  secretStore: SecretStore;
}): Promise<MandateStatusReadiness> {
  const mandateReadiness: MandateStatusReadiness["mandates"] = {};
  let gitBinding: { worktreePath: string; branch: string } | undefined;
  if (options.repoPath) {
    try {
      gitBinding = resolveGitWorktreeBinding(options.repoPath);
    } catch {
      gitBinding = undefined;
    }
  }

  let missingSecretRefs: MissingSecretRef[] = [];
  if (options.repoPath) {
    const loaded = loadSwitchboardConfig(optionsFromCwd(options.cwd));
    if (!loadedConfigCommandError(loaded)) {
      missingSecretRefs = await findMissingSecretRefs(
        loaded.config,
        options.secretStore
      );
    }
  }

  for (const mandate of options.mandates) {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const nextActions: string[] = [];

    if (mandate.runtimeStatus === "expired") {
      blockers.push(`mandate "${mandate.id}" is expired`);
      nextActions.push(`switchboard mandate renew ${mandate.id} --lease ${mandate.lease}`);
    }
    if (mandate.runtimeStatus === "closed") {
      warnings.push(
        `mandate "${mandate.id}" is closed with handoff state "${mandate.handoffState}"`
      );
    }
    if (gitBinding && mandate.branch !== gitBinding.branch) {
      blockers.push(
        `mandate "${mandate.id}" is scoped to branch "${mandate.branch}", but current git branch is "${gitBinding.branch}"`
      );
      nextActions.push(`git switch ${mandate.branch}`);
    }
    if (gitBinding && mandate.worktreePath !== gitBinding.worktreePath) {
      blockers.push(
        `mandate "${mandate.id}" is scoped to worktree "${mandate.worktreePath}", but current worktree is "${gitBinding.worktreePath}"`
      );
      nextActions.push(`cd ${mandate.worktreePath}`);
    }

    const mandateProfiles = new Set(mandate.profiles);
    for (const missing of missingSecretRefs) {
      const usedByMandate = missing.usages.some((usage) =>
        mandateProfiles.has(usage.profileName)
      );
      if (!usedByMandate) {
        continue;
      }
      blockers.push(`secretRef "${missing.ref}" is ${missing.status}`);
      nextActions.push(`switchboard secrets set ${missing.ref} --value-stdin`);
    }

    mandateReadiness[mandate.id] = {
      blockers: uniqueStrings(blockers),
      warnings: uniqueStrings(warnings),
      nextActions: uniqueStrings(nextActions)
    };
  }

  return {
    blockers: uniqueStrings(
      Object.values(mandateReadiness).flatMap((readiness) => readiness.blockers)
    ),
    warnings: uniqueStrings(
      Object.values(mandateReadiness).flatMap((readiness) => readiness.warnings)
    ),
    nextActions: uniqueStrings(
      Object.values(mandateReadiness).flatMap((readiness) => readiness.nextActions)
    ),
    mandates: mandateReadiness
  };
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
    `Ready to hand off selected: ${report.readiness.selectedCanHandoff ? "yes" : "no"}`,
    `Results: handoffs:${report.results.counts.handoffs} summaries:${report.results.counts.summaries} nextSteps:${report.results.counts.nextSteps} artifacts:${report.results.counts.artifacts}`,
    `Approval requests: ${report.counts.approvalRequests}`,
    `Audit entries: ${report.counts.auditEntries}`
  ];

  if (report.readiness.blockers.length > 0) {
    lines.push("", "Readiness blockers:");
    for (const blocker of report.readiness.blockers) {
      lines.push(`  ${blocker}`);
    }
  }

  if (report.readiness.missingSecretRefs.length > 0) {
    lines.push("", "Missing secret refs:");
    for (const missing of report.readiness.missingSecretRefs) {
      lines.push(
        `  ${missing.ref} (${missing.status}) - profiles:${missing.profiles.join(", ")} env:${missing.envNames.join(", ")}`
      );
    }
  }

  if (report.results.handoffs.length > 0) {
    lines.push("", "Handoff results:");
    for (const handoff of report.results.handoffs) {
      const actor = handoff.by ? ` by:${handoff.by}` : "";
      const timestamp = handoff.at ? ` at:${handoff.at}` : "";
      lines.push(`  ${handoff.id} ${handoff.state}${actor}${timestamp}`);
      if (handoff.summary) {
        lines.push(`    Summary: ${handoff.summary}`);
      }
      if (handoff.nextSteps.length > 0) {
        lines.push(`    Next: ${handoff.nextSteps.join("; ")}`);
      }
      if (handoff.artifacts.length > 0) {
        lines.push(`    Artifacts: ${handoff.artifacts.join(", ")}`);
      }
    }
  }

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

function formatMandateEscalation(escalation: MandateEscalationPayload): string {
  const lines = [
    "Switchboard mandate escalation",
    `Store: ${escalation.path}`,
    `Repo: ${escalation.repoPath ?? "all"}`,
    `Root: ${escalation.rootMandateId}`,
    `Selected: ${escalation.selectedMandateId}`,
    `Status: ${escalation.status}`,
    `Items: ${escalation.counts.items} approvals:${escalation.counts.approvalRequests} openChildren:${escalation.counts.openChildMandates} blocked:${escalation.counts.blockedHandoffs} cancelled:${escalation.counts.cancelledHandoffs}`
  ];

  if (escalation.items.length === 0) {
    lines.push("", "No local escalation items.");
    return lines.join("\n");
  }

  lines.push("", "Escalation items:");
  for (const item of escalation.items) {
    lines.push(`  ${item.type} ${item.mandateId}: ${item.title}`);
    lines.push(`    ${item.detail}`);
    if (item.nextSteps && item.nextSteps.length > 0) {
      lines.push(`    Next: ${item.nextSteps.join("; ")}`);
    }
    if (item.artifacts && item.artifacts.length > 0) {
      lines.push(`    Artifacts: ${item.artifacts.join(", ")}`);
    }
  }

  if (escalation.nextCommands.length > 0) {
    lines.push("", "Suggested local commands:");
    for (const command of escalation.nextCommands) {
      lines.push(`  ${command}`);
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
  counts?: {
    requests: number;
    pending: number;
    approved: number;
    denied: number;
    stale: number;
    expired: number;
  };
  mandateId?: string | null;
  includeChildren?: boolean;
  requests: ApprovalRequestWithStatus[];
}): string {
  const lines = [
    "Switchboard approval requests",
    `Store: ${result.path}`,
    `Repo: ${result.repoPath ?? "all"}`
  ];

  if (result.mandateId) {
    lines.push(
      `Scope: mandate ${result.mandateId}${
        result.includeChildren ? " + children" : ""
      }`
    );
  }

  if (result.counts) {
    lines.push(
      `Summary: ${result.counts.pending} pending, ${result.counts.approved} approved, ${result.counts.denied} denied, ${result.counts.expired} expired, ${result.counts.stale} stale`
    );
  }

  if (result.requests.length === 0) {
    lines.push("", "No approval requests found.");
    return lines.join("\n");
  }

  lines.push("");
  for (const request of result.requests) {
    lines.push(`${request.id} [${request.runtimeStatus}]`);
    lines.push(`  mandate: ${request.mandateId}`);
    if (request.parentMandateId) {
      lines.push(`  parent: ${request.parentMandateId}`);
    }
    if (request.delegatedBy) {
      lines.push(`  delegated by: ${request.delegatedBy}`);
    }
    if (request.delegationPath) {
      lines.push(`  delegation path: ${request.delegationPath.join(" > ")}`);
    }
    lines.push(`  branch: ${request.branch}`);
    lines.push(`  tool: ${request.toolName}`);
    lines.push(
      `  gate: ${request.approvalGateId} (${request.approvalGatePattern})`
    );
    if (request.approvalGateRisk) {
      lines.push(`  risk: ${request.approvalGateRisk}`);
    }
    if (request.approvalGateLabels && request.approvalGateLabels.length > 0) {
      lines.push(`  labels: ${request.approvalGateLabels.join(", ")}`);
    }
    if (request.approvalGateReason) {
      lines.push(`  reason: ${request.approvalGateReason}`);
    }
    lines.push(`  expires: ${request.expiresAt}`);
    const nextActions = approvalRequestNextActions(request);
    if (nextActions.length > 0) {
      lines.push("  next:");
      for (const action of nextActions) {
        lines.push(`    ${action}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function approvalRequestNextActions(
  request: ApprovalRequestWithStatus
): string[] {
  if (request.runtimeStatus === "pending") {
    return [
      `switchboard approve ${request.id} --reason "<why this is safe>"`,
      `switchboard deny ${request.id} --reason "<why this should not run>"`,
      `retry the original ${request.toolName} tool call after approval`
    ];
  }

  if (request.runtimeStatus === "expired") {
    return ["retry the original gated tool call to create a fresh approval request"];
  }

  if (request.runtimeStatus === "stale") {
    return ["retry the original gated tool call to create a fresh approval request"];
  }

  return [];
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

function secretIndexOptions(path: string | undefined): { path?: string } {
  return path ? { path } : {};
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function readHiddenPrompt(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stderr;

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error(
      "interactive token prompt requires a terminal; use --value-stdin for scripts"
    );
  }

  output.write(prompt);
  input.resume();
  input.setRawMode(true);

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = (): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("token entry cancelled"));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }

        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        if (char >= " ") {
          value += char;
        }
      }
    };

    input.on("data", onData);
  });
}

function configureParserErrorHandling(
  command: Command,
  options: {
    writeOut: (message: string) => void;
    writeErr: (message: string) => void;
    currentParseArgs: () => string[];
    writeCommandError: (error: CommandErrorOptions) => void;
  }
): void {
  command.exitOverride((error) => {
    throw error;
  });
  command.configureOutput({
    writeOut: (message) => options.writeOut(message.trimEnd()),
    writeErr: (message) => options.writeErr(message.trimEnd()),
    outputError: (message, write) => {
      if (shouldWriteContractParserErrorAsJson(options.currentParseArgs())) {
        options.writeCommandError({
          json: true,
          code: parserErrorCode(message),
          message: parserErrorMessage(message)
        });
        return;
      }

      write(message.trimEnd());
    }
  });

  for (const child of command.commands) {
    configureParserErrorHandling(child, options);
  }
}

function userArgsFromParseInput(
  argv: Parameters<Command["parseAsync"]>[0],
  options: Parameters<Command["parseAsync"]>[1]
): string[] {
  const rawArgs = [...(argv ?? process.argv)];
  if (options?.from === "user") {
    return rawArgs;
  }
  if (options?.from === "electron") {
    return rawArgs.slice(1);
  }
  return rawArgs.slice(2);
}

function shouldWriteContractParserErrorAsJson(args: string[]): boolean {
  if (!args.includes("--json")) {
    return false;
  }

  const commandIndex = topLevelCommandIndex(args);
  if (commandIndex === undefined) {
    return false;
  }

  const command = args[commandIndex];
  if (command === "approvals" || command === "logs" || command === "tools") {
    return true;
  }

  if (command !== "mandate") {
    return false;
  }

  const mandateCommand = args[commandIndex + 1];
  return (
    mandateCommand !== undefined &&
    ["create", "child", "status", "handoff", "report", "escalate"].includes(
      mandateCommand
    )
  );
}

function topLevelCommandIndex(args: string[]): number | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cwd") {
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cwd=")) {
      continue;
    }
    if (arg?.startsWith("-")) {
      continue;
    }

    return index;
  }

  return undefined;
}

function parserErrorMessage(message: string): string {
  return message.replace(/^error:\s*/, "").trim();
}

function parserErrorCode(message: string): string {
  const normalized = parserErrorMessage(message);
  if (normalized.startsWith("required option")) {
    return "missing_required_option";
  }
  if (normalized.startsWith("missing required argument")) {
    return "missing_required_argument";
  }
  if (normalized.startsWith("unknown option")) {
    return "unknown_option";
  }

  return "invalid_command";
}

function mandateCommandError(
  error: unknown,
  fallbackCode: string
): { code: string; message: string; nextActions: string[] } {
  const message = messageFromError(error);
  return {
    code: isMandateNotFoundMessage(message)
      ? "mandate_not_found"
      : isMandateExpiredMessage(message)
        ? "mandate_expired"
        : fallbackCode,
    message,
    nextActions: mandateRecoveryNextActions(message)
  };
}

function isMandateNotFoundMessage(message: string): boolean {
  return (
    /^mandate "[^"]+" was not found(?:$|\sfor\s)/.test(message) ||
    /^active parent mandate "[^"]+" was not found(?:$|\sfor\s)/.test(message)
  );
}

function isMandateExpiredMessage(message: string): boolean {
  return /^mandate "[^"]+" is expired$/.test(message);
}

function mandateRecoveryNextActions(message: string): string[] {
  const expired = /^mandate "([^"]+)" is expired$/.exec(message);
  if (expired?.[1]) {
    return [
      `switchboard mandate renew ${expired[1]} --lease 2h`,
      `switchboard mandate create ${expired[1]} --lease 2h --agent <role> --profiles <profiles> --branch <branch>`
    ];
  }

  const missing = /^mandate "([^"]+)" was not found/.exec(message);
  if (missing?.[1]) {
    return ["Run switchboard mandate status to list mandates for this repo."];
  }

  const branchMismatch =
    /^mandate "([^"]+)" is scoped to branch "([^"]+)", but current git branch is "([^"]+)"/.exec(
      message
    );
  if (branchMismatch?.[2]) {
    return [
      `git switch ${branchMismatch[2]}`,
      `switchboard mandate status ${branchMismatch[1] ?? ""}`.trim()
    ];
  }

  return [];
}

function approvalGateLabels(
  options: {
    requireApprovalLabel: string[];
    requireApprovalLabels: string[];
  },
  index: number
): string[] {
  return uniqueStrings([
    ...options.requireApprovalLabel,
    ...parseCommaSeparatedList(options.requireApprovalLabels[index] ?? "")
  ]);
}

function commandErrorEnvelope(
  options: CommandErrorOptions
): CommandErrorEnvelope {
  return {
    ok: false,
    schemaVersion: errorSchemaVersion,
    code: options.code,
    message: options.message,
    nextActions: options.nextActions ?? []
  };
}

function loadedConfigCommandError(
  loaded: ReturnType<typeof loadSwitchboardConfig>
): { code: string; message: string; nextActions: string[] } | undefined {
  if (loaded.namespaceCollisions.length > 0) {
    return {
      code: "namespace_collision",
      message: loaded.namespaceCollisions
        .map(
          (collision) =>
            `namespace "${collision.namespace}" is used by profiles: ${collision.profiles.join(", ")}`
        )
        .join("; "),
      nextActions: ["Run switchboard doctor for config diagnostics."]
    };
  }

  const blockingDiagnostics = loaded.diagnostics.filter(
    (diagnostic) => diagnostic.level === "error"
  );
  if (blockingDiagnostics.length > 0) {
    return {
      code: "invalid_config",
      message: blockingDiagnostics
        .map((diagnostic) => diagnostic.message)
        .join("; "),
      nextActions: ["Run switchboard doctor for config diagnostics."]
    };
  }

  return undefined;
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
  json?: boolean;
  writeCommandError?: (error: CommandErrorOptions) => void;
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
    if (options.json && options.writeCommandError) {
      const { code, message, nextActions } = mandateCommandError(
        error,
        "active_mandate_failed"
      );
      options.writeCommandError({
        json: true,
        code,
        message,
        nextActions
      });
      return undefined;
    }

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
  clientLaunches: ClientLaunchCheck[];
  missingSecrets: MissingSecretRef[];
  bypassFindings: BypassFinding[];
  cwd: string | undefined;
}): string[] {
  const steps: string[] = [];
  const hasRepoConfig = options.loaded.sources.some(
    (source) => source.kind === "repo" && source.loaded
  );
  const stdioProfiles = stdioProfilePreviewsFromConfig(
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

  for (const missing of options.missingSecrets) {
    steps.push(
      providerAuthCommandForMissingSecret(missing, options.loaded.config) ??
        `switchboard secrets set ${missing.ref} --value-stdin`
    );
  }

  for (const config of options.clientConfigs) {
    if (config.status === "invalid") {
      steps.push(`fix ${config.targetPath}, then rerun switchboard doctor`);
    }
  }

  for (const launch of options.clientLaunches) {
    if (!launch.ok) {
      steps.push(
        `${clientLaunchInstallHint(launch.command)}, then rerun switchboard install ${launch.client} --write`
      );
    }
  }

  if (options.bypassFindings.length > 0) {
    steps.push("switchboard import --dry-run");
  }

  if (placeholderProfiles.length > 0) {
    steps.push("edit .switchboard.yaml and replace the starter upstream args");
  }

  const readyProfile = stdioProfiles.find(
    (profile) => !placeholderProfiles.includes(profile)
  );
  if (options.ok && readyProfile) {
    steps.push(`switchboard test ${readyProfile.profileName}`);
    for (const step of providerTemplateDoctorNextSteps(
      options.loaded.config.profiles
    )) {
      steps.push(step);
    }
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

function providerAuthCommandForMissingSecret(
  missing: MissingSecretRef,
  config: SwitchboardConfig
): string | undefined {
  const usage = missing.usages[0];
  const profile = usage ? config.profiles[usage.profileName] : undefined;
  if (!profile) {
    return undefined;
  }

  const preset =
    profile.provider === "github"
      ? getProviderSafetyTemplate("github-ci")
      : profile.provider === "vercel"
        ? getProviderSafetyTemplate("vercel-preview")
        : profile.provider === "stripe"
          ? getProviderSafetyTemplate("stripe-test")
          : undefined;
  if (!preset) {
    return undefined;
  }

  const base = `switchboard auth ${preset.id}`;
  return missing.ref === preset.defaultSecretRef
    ? base
    : `${base} --secret-ref ${shellQuoteCommandArg(missing.ref)}`;
}

function providerTemplateDoctorNextSteps(
  profiles: SwitchboardConfig["profiles"]
): string[] {
  const steps: string[] = [];

  for (const [profileName, profile] of Object.entries(profiles)) {
    if (profile.provider === "github") {
      steps.push(`switchboard presets check github-ci --profile ${profileName}`);
      steps.push("switchboard mandate create --from github-ci");
    }

    if (profile.provider === "vercel") {
      steps.push(
        `switchboard presets check vercel-preview --profile ${profileName}`
      );
      steps.push("switchboard mandate create --from vercel-preview");
    }

    if (profile.provider === "stripe") {
      steps.push(`switchboard presets check stripe-test --profile ${profileName}`);
      steps.push("switchboard mandate create --from stripe-test");
    }
  }

  return steps;
}

type RunReadinessResult =
  | {
      ok: true;
      commandPath: string;
      env: Record<string, string>;
      envKeys: string[];
    }
  | {
      ok: false;
      code: string;
      message: string;
      nextActions: string[];
      envKeys: string[];
    };

async function validateRunReadiness(options: {
  cwd: string;
  command: string;
  args: string[];
  mandate: MandateWithStatus;
  config: SwitchboardConfig;
  secretStore: SecretStore;
}): Promise<RunReadinessResult> {
  const cwdPath = realPathOrResolve(options.cwd);
  const repoPath = realPathOrResolve(options.mandate.repoPath);
  const worktreePath = realPathOrResolve(options.mandate.worktreePath);

  if (cwdPath !== repoPath) {
    return {
      ok: false,
      code: "repo_mismatch",
      message: `mandate "${options.mandate.id}" is scoped to ${options.mandate.repoPath}, not ${options.cwd}`,
      nextActions: [`cd ${shellQuoteCommandArg(options.mandate.repoPath)}`],
      envKeys: []
    };
  }

  if (cwdPath !== worktreePath) {
    return {
      ok: false,
      code: "worktree_mismatch",
      message: `mandate "${options.mandate.id}" is scoped to worktree ${options.mandate.worktreePath}`,
      nextActions: [`cd ${shellQuoteCommandArg(options.mandate.worktreePath)}`],
      envKeys: []
    };
  }

  const branch = currentGitBranch(options.cwd);
  if (branch && branch !== options.mandate.branch) {
    return {
      ok: false,
      code: "branch_mismatch",
      message: `mandate "${options.mandate.id}" is scoped to branch ${options.mandate.branch}, but current branch is ${branch}`,
      nextActions: [`git switch ${shellQuoteCommandArg(options.mandate.branch)}`],
      envKeys: []
    };
  }

  if (options.mandate.handoffState !== "open") {
    return {
      ok: false,
      code: "handoff_closed",
      message: `mandate "${options.mandate.id}" is closed with handoff state "${options.mandate.handoffState}"`,
      nextActions: [`switchboard mandate status ${options.mandate.id}`],
      envKeys: []
    };
  }

  const missingProfiles = options.mandate.profiles.filter(
    (profileName) => !options.config.profiles[profileName]
  );
  if (missingProfiles.length > 0) {
    return {
      ok: false,
      code: "missing_profiles",
      message: `mandate profiles were not found: ${missingProfiles.join(", ")}`,
      nextActions: ["Run switchboard status to list configured profiles."],
      envKeys: []
    };
  }

  const commandClass = classifyRunCommand(options.command);
  if (
    commandClass.kind === "denied" ||
    (commandClass.kind === "unclassified" &&
      !mandateAllowsRunCommand(options.mandate, commandClass.name))
  ) {
    return {
      ok: false,
      code: "run_command_denied",
      message:
        commandClass.kind === "denied"
          ? `${commandClass.name} is denied by default in switchboard run; shell wrappers and package scripts are not classified in V0.`
          : `${commandClass.name} is unclassified in switchboard run V0.`,
      nextActions: [
        `Use gh, vercel, stripe, or a fixture CLI directly, or create a mandate with --allow-tool run:${commandClass.name}.`
      ],
      envKeys: []
    };
  }

  const envResult = await envForMandateProfiles({
    config: options.config,
    profiles: options.mandate.profiles,
    secretStore: options.secretStore
  });
  if (!envResult.ok) {
    return {
      ok: false,
      code: "missing_secret",
      message: envResult.message,
      nextActions: envResult.nextActions,
      envKeys: envResult.envKeys
    };
  }

  const commandPath = resolveRunCommandPath(options.command);
  if (!commandPath) {
    return {
      ok: false,
      code: "command_not_found",
      message: `command "${options.command}" was not found`,
      nextActions: [`Install ${options.command} or pass an absolute command path.`],
      envKeys: Object.keys(envResult.env).sort()
    };
  }

  return {
    ok: true,
    commandPath,
    env: envResult.env,
    envKeys: Object.keys(envResult.env).sort()
  };
}

async function envForMandateProfiles(options: {
  config: SwitchboardConfig;
  profiles: string[];
  secretStore: SecretStore;
}): Promise<
  | { ok: true; env: Record<string, string>; envKeys: string[] }
  | { ok: false; message: string; nextActions: string[]; envKeys: string[] }
> {
  const env: Record<string, string> = {};
  const envKeys: string[] = [];

  for (const profileName of options.profiles) {
    const profile = options.config.profiles[profileName];
    const upstreamEnv = profile?.upstream?.env ?? {};
    for (const [envName, value] of Object.entries(upstreamEnv)) {
      if (!isSecretRefRuntimeValue(value)) {
        continue;
      }
      envKeys.push(envName);
      const secret = await options.secretStore.get(value.secretRef);
      if (secret === null) {
        return {
          ok: false,
          message: `secretRef "${value.secretRef}" is not set`,
          nextActions: [
            `switchboard secrets set ${value.secretRef} --value-stdin`
          ],
          envKeys: [...new Set(envKeys)].sort()
        };
      }
      env[envName] = secret;
    }
  }

  return { ok: true, env, envKeys: Object.keys(env).sort() };
}

function isSecretRefRuntimeValue(value: unknown): value is { secretRef: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "secretRef" in value &&
    typeof value.secretRef === "string"
  );
}

function classifyRunCommand(
  command: string
): { kind: "allowed" | "denied" | "unclassified"; name: string } {
  const name = basename(command);
  if (["gh", "vercel", "stripe", "fixture"].includes(name)) {
    return { kind: "allowed", name };
  }
  if (
    [
      "bash",
      "sh",
      "zsh",
      "fish",
      "node",
      "npm",
      "pnpm",
      "yarn",
      "bun",
      "python",
      "python3",
      "ruby",
      "perl"
    ].includes(name)
  ) {
    return { kind: "denied", name };
  }
  return { kind: "unclassified", name };
}

function mandateAllowsRunCommand(mandate: MandateWithStatus, name: string): boolean {
  return mandate.allowedTools.some(
    (pattern) => pattern === "run:*" || pattern === `run:${name}`
  );
}

function resolveRunCommandPath(command: string): string | null {
  if (isAbsolute(command)) {
    return command;
  }

  try {
    return execFileSync("which", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function realPathOrResolve(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function snippet(value: string): string {
  return redactCommandOutput(value).slice(0, 2_000);
}

function redactCommandOutput(value: string): string {
  return value
    .replace(/https?:\/\/([^/\s:@]+):([^/\s@]+)@/gi, "https://[redacted]@")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{8,})\b/g, "[redacted]")
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{8,})\b/g, "[redacted]")
    .replace(
      /\b(authorization\s*:\s*bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
      "$1 [redacted]"
    )
    .replace(/\b(token|secret|password|api[_-]?key)=\S+/gi, "$1=[redacted]");
}

function runErrorCode(message: string): string {
  if (message.includes("expired")) {
    return "mandate_expired";
  }
  if (message.includes("closed")) {
    return "handoff_closed";
  }
  if (message.includes("was not found")) {
    return "mandate_not_found";
  }
  return "run_failed";
}

function runErrorNextActions(message: string, mandateId: string): string[] {
  if (message.includes("expired")) {
    return [`switchboard mandate renew ${mandateId} --lease 2h`];
  }
  if (message.includes("closed")) {
    return [`switchboard mandate status ${mandateId}`];
  }
  if (message.includes("was not found")) {
    return ["switchboard mandate status"];
  }
  return ["Run switchboard doctor."];
}

function clientLaunchSummary(launches: ClientLaunchCheck[]): string {
  if (launches.length === 0) {
    return "No installed project client configs to launch yet.";
  }

  const ready = launches.filter((launch) => launch.ok).length;
  if (ready === launches.length) {
    return `${ready}/${launches.length} installed client launch command(s) are available.`;
  }

  return `${ready}/${launches.length} installed client launch command(s) are available.`;
}

function clientLaunchInstallHint(command: string): string {
  if (command === "switchboard") {
    return "install Switchboard with npm install -g @switchboard-mcp/cli";
  }

  if (isAbsolute(command)) {
    return `make ${command} executable`;
  }

  return `install or link ${command}`;
}

function doctorStatus(options: {
  ok: boolean;
  nextSteps: string[];
}): "ok" | "setup-incomplete" | "failed" {
  if (!options.ok) {
    return "failed";
  }

  const setupSteps = options.nextSteps.filter(isSetupIncompleteStep);
  return setupSteps.length > 0 ? "setup-incomplete" : "ok";
}

function isSetupIncompleteStep(step: string): boolean {
  const switchboardIndex = step.indexOf(" switchboard ");
  const command =
    step.startsWith("pnpm ") && switchboardIndex !== -1
      ? step.slice(switchboardIndex + " switchboard ".length)
      : step.startsWith("switchboard ")
        ? step.slice("switchboard ".length)
        : step;
  const subcommand = command.replace(/^--cwd\s+\S+\s+/, "");

  return !(
    subcommand.startsWith("test ") ||
    subcommand.startsWith("presets check ") ||
    subcommand.startsWith("mandate create ")
  );
}

function resolveInstallLaunch(options: {
  command?: string;
  commandArgs: string[];
}): { command: string; commandArgs: string[] } {
  if (options.command !== undefined) {
    return {
      command: options.command,
      commandArgs: options.commandArgs
    };
  }

  if (options.commandArgs.length > 0) {
    return {
      command: "switchboard",
      commandArgs: options.commandArgs
    };
  }

  const sourceEntrypoint = sourceCheckoutEntrypoint();
  if (sourceEntrypoint) {
    return {
      command: process.execPath,
      commandArgs: [sourceEntrypoint]
    };
  }

  return {
    command: "switchboard",
    commandArgs: []
  };
}

function sourceCheckoutEntrypoint(): string | null {
  const sourceRoot = sourceCheckoutRoot();
  if (!sourceRoot) {
    return null;
  }

  return resolve(sourceRoot, "apps", "cli", "dist", "index.js");
}

function sourceCheckoutRoot(): string | null {
  if (
    process.env.npm_lifecycle_event !== "switchboard" ||
    process.env.npm_package_name !== "switchboard"
  ) {
    return null;
  }

  const entrypoint = process.argv[1];
  if (!entrypoint || !entrypoint.endsWith(`${sep}apps${sep}cli${sep}dist${sep}index.js`)) {
    return null;
  }

  return resolve(
    entrypoint.slice(
      0,
      -`${sep}apps${sep}cli${sep}dist${sep}index.js`.length
    )
  );
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

function stdioProfilePreviewsFromConfig(
  profiles: ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"],
  cwdBase: string
): StdioUpstreamProfile[] {
  return Object.entries(profiles).flatMap(([profileName, profile]) => {
    const upstream = profileConfigToStdioUpstream(profileName, profile, {
      cwdBase,
      unresolvedSecretBehavior: "omit"
    });
    return upstream ? [upstream] : [];
  });
}

async function stdioProfilesFromConfig(
  profiles: ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"],
  cwdBase: string,
  secretStore: SecretStore
): Promise<StdioUpstreamProfile[]> {
  const upstreams = await Promise.all(
    Object.entries(profiles).map(([profileName, profile]) =>
      profileConfigToStdioUpstreamWithSecrets(profileName, profile, {
        cwdBase,
        secretStore
      })
    )
  );
  return upstreams.filter((upstream): upstream is StdioUpstreamProfile =>
    Boolean(upstream)
  );
}

async function stdioProfilesFromConfigForCommand(options: {
  profiles: ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"];
  cwdBase: string;
  secretStore: SecretStore;
  json: boolean | undefined;
  writeCommandError: (error: CommandErrorOptions) => void;
  writeErr: (message: string) => void;
}): Promise<StdioUpstreamProfile[] | undefined> {
  try {
    return await stdioProfilesFromConfig(
      options.profiles,
      options.cwdBase,
      options.secretStore
    );
  } catch (error) {
    const message = messageFromError(error);
    options.writeCommandError({
      json: options.json,
      code: "secret_resolution_failed",
      message,
      nextActions: secretResolutionNextActions(message)
    });
    return undefined;
  }
}

function secretResolutionNextActions(message: string): string[] {
  const ref = /secretRef "([^"]+)"/.exec(message)?.[1];
  return ref
    ? [`switchboard secrets set ${ref} --value-stdin`]
    : ["Run switchboard secrets doctor to inspect configured secretRefs."];
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
