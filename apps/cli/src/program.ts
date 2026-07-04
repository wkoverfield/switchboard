import { Command } from "commander";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  type AuditLogEntry,
  type AuditLogger,
  checkAuthorityMapDraft,
  createRepoAudit,
  type ApprovalRequestWithStatus,
  checkLocalConfigIgnored,
  checkInstalledClientLaunches,
  createChildMandate,
  draftAuthorityMap,
  parseAuthorityMapDraft,
  type AuthorityMapDraft,
  type AuthorityMapCheckResult,
  type RepoAuditResult,
  createMandate,
  decideApprovalRequest,
  createInitConfigPlan,
  inspectProjectClientConfigs,
  listApprovalRequests,
  listMandates,
  diffManifestClientRoutes,
  type LoadConfigOptions,
  loadSwitchboardConfig,
  type MandateAuthoritySource,
  type ManifestRouteDiff,
  type MandateLeaseEvent,
  type MandateToolPolicy,
  type MandateWithStatus,
  noopAuditLogger,
  namespacesForProfiles,
  normalizeMandateId,
  parseMandateLease,
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
  describeSecretBackendError,
  type SecretBackendErrorHelp,
  getProviderSafetyTemplate,
  probeSecretStore,
  secretStoreProbeRef,
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
  type RiskFinding,
  planAuthorityStatus,
  type AuthorityStatus,
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

// Read the version from package.json so it never drifts from the published
// package. "../package.json" resolves the same from dist/program.js and from
// src/program.ts (both sit one level under the package root).
const version = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { version: string }
).version;
const mandateMcpLaunchSchemaVersion = "switchboard.mcp-launch.v1";
const workspaceLeaseSchemaVersion = "switchboard.workspace-lease.v1";
const mandateStatusSchemaVersion = "switchboard.mandate-status.v1";
const mandateReportSchemaVersion = "switchboard.mandate-report.v1";
const mandateEscalationSchemaVersion = "switchboard.mandate-escalation.v1";
const approvalRequestsSchemaVersion = "switchboard.approvals.v1";
const approvalWatchSchemaVersion = "switchboard.approvals-watch.v1";
const toolSurfaceSchemaVersion = "switchboard.tool-surface.v1";
const auditLogSchemaVersion = "switchboard.audit-log.v1";
const repoAuditExportSchemaVersion = "switchboard.repo-audit-export.v1";
const repoManifestSchemaVersion = "switchboard.repo-manifest.v1";
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
  policyHash: string | null;
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
    createdBy: string | null;
    source: MandateAuthoritySource | null;
    policyHash: string | null;
    parentMandateId?: string;
    parentMandateUid?: string;
  };
  lease: {
    createdAt: string;
    expiresAt: string;
    status: MandateWithStatus["runtimeStatus"];
    events: MandateLeaseEvent[];
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
  evidence: MandateReportEvidence[];
  childrenByParent: Record<string, string[]>;
  mandates: MandateWithStatus[];
  approvalRequests: ApprovalRequestWithStatus[];
  auditEntries: AuditLogEntry[];
}

interface MandateReportEvidence {
  id: string;
  mandateUid: string | null;
  createdBy: string | null;
  authoritySource: MandateAuthoritySource | null;
  policyHash: string | null;
  leaseEvents: MandateLeaseEvent[];
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
    approvalGateReason?: string;
    approvalGateRisk?: ApprovalRequestWithStatus["approvalGateRisk"];
    approvalGateLabels?: string[];
    expiresAt: string;
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
  approvalGateReason?: string;
  approvalGateRisk?: ApprovalRequestWithStatus["approvalGateRisk"];
  approvalGateLabels?: string[];
  expiresAt?: string;
  state?: Exclude<MandateWithStatus["handoffState"], "open">;
  summary?: string | null;
  nextSteps?: string[];
  nextActions?: string[];
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

interface ApprovalRequestsPayloadOptions {
  path: string;
  mandateStorePath: string;
  repoPath?: string;
  mandateId?: string | null;
  includeChildren: boolean;
  status?: ApprovalRequestWithStatus["runtimeStatus"];
}

interface ApprovalWatchPayload {
  schemaVersion: typeof approvalWatchSchemaVersion;
  generatedAt: string;
  watch: {
    intervalMs: number;
    timeoutMs: number | null;
    snapshots: number;
  };
  snapshots: Array<{
    observedAt: string;
    approvals: ApprovalRequestsPayload;
  }>;
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
      timeoutMs?: number;
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
      timeoutMs?: number;
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
  /** Force ANSI color on or off; default: on only for a real TTY. */
  color?: boolean;
}

// Zero-dependency ANSI painting. Off unless stdout is a real TTY, and
// always off under NO_COLOR or TERM=dumb, so piped/captured output stays
// plain text. io.color is the explicit override (used by tests).
function detectColorEnabled(): boolean {
  if ("NO_COLOR" in process.env) {
    return false;
  }
  if (process.env.TERM === "dumb") {
    return false;
  }
  return process.stdout.isTTY === true;
}

type Paint = {
  bold: (text: string) => string;
  dim: (text: string) => string;
  green: (text: string) => string;
  yellow: (text: string) => string;
};

function makePaint(enabled: boolean): Paint {
  const wrap =
    (open: string, close: string) =>
    (text: string): string =>
      enabled ? `[${open}m${text}[${close}m` : text;
  return {
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    green: wrap("32", "39"),
    yellow: wrap("33", "39")
  };
}

export function createProgram(io: ProgramIo = {}): Command {
  const writeOut = io.writeOut ?? ((message: string) => console.log(message));
  const writeErr = io.writeErr ?? ((message: string) => console.error(message));
  const paint = makePaint(io.color ?? detectColorEnabled());
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
  // Secret-store failures are recoverable, but only if we show the recovery
  // steps. Human errors normally omit nextActions, so surface them here.
  const writeSecretBackendError = async (
    json: boolean | undefined,
    error: unknown,
    code: string
  ): Promise<void> => {
    const envelope = await secretBackendErrorEnvelope(secretStore, error, code);
    writeCommandError({ json, ...envelope });
    if (!json && envelope.nextActions.length > 0) {
      writeErr("To fix:");
      for (const action of envelope.nextActions) {
        writeErr(`  ${action}`);
      }
    }
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
      "Take control of what your AI coding agents can reach: see the tools and tokens they can touch in a repo, get secrets out of plaintext config, and scope each agent's access."
    )
    .version(version)
    .option("--cwd <path>", "resolve repo config from this directory");

  program
    .command("scan")
    .description("See which MCP servers and tokens your agents can reach in this repo — and what's exposed.")
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
    .command("manifest")
    .description("Print the repo-level Switchboard authority manifest.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const manifest = await createRepoManifestForCurrentInvocation(program, {
        secretStore
      });
      writeOut(
        options.json
          ? JSON.stringify(manifest, null, 2)
          : formatRepoManifest(manifest)
      );
    });

  const auditCommand = program
    .command("audit")
    .description("Audit this repo's coding-agent tool authority posture.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const audit = await createRepoAuditForCurrentInvocation(program);

      writeOut(
        options.json
          ? JSON.stringify(audit, null, 2)
          : formatRepoAudit(audit)
      );
    });

  auditCommand
    .command("export")
    .description("Export the repo authority audit as JSONL evidence.")
    .option("--format <format>", "export format", "jsonl")
    .option(
      "--include <sections>",
      "comma-separated extra evidence sections: mandates, approvals, logs, or all"
    )
    .option(
      "--log-limit <count>",
      "maximum audit log entries when logs are included",
      "200"
    )
    .action(
      async (options: {
        format?: string;
        include?: string;
        logLimit: string;
      }) => {
        if ((options.format ?? "jsonl") !== "jsonl") {
          writeErr("error: only --format jsonl is supported");
          process.exitCode = 1;
          return;
        }

        const include = parseAuditExportInclude(options.include);
        if (!include.ok) {
          writeErr(`error: ${include.message}`);
          process.exitCode = 1;
          return;
        }
        const logLimit = parsePositiveInteger(options.logLimit);
        if (logLimit === undefined) {
          writeErr("error: --log-limit must be a positive integer");
          process.exitCode = 1;
          return;
        }

        const globalOptions = program.opts<{ cwd?: string }>();
        const audit = await createRepoAuditForCurrentInvocation(program);
        const includesEvidence =
          include.sections.mandates ||
          include.sections.approvals ||
          include.sections.logs;
        const evidence = includesEvidence
          ? await collectRepoAuditExportEvidence({
              repoPath: installTargetCwd(globalOptions.cwd),
              include: include.sections,
              logLimit,
              mandateStorePath:
                io.mandateStorePath ?? resolveMandateStorePath(),
              approvalStorePath:
                io.approvalStorePath ?? resolveApprovalRequestStorePath(),
              auditLogPath: io.auditLogPath ?? resolveAuditLogPath()
            })
          : undefined;
        writeOut(formatRepoAuditJsonl(audit, evidence));
      }
    );

  program
    .command("run")
    .description("Run an allowed provider command with pass-scoped credentials and audit.")
    .requiredOption("--mandate <id>", "active pass id")
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
            message: mandateMessageInPassVocabulary(message),
            nextActions: runErrorNextActions(message, options.mandate)
          });
          process.exitCode = 1;
        }
      }
    );

  program
    .command("import")
    .description("Consolidate scattered MCP config and swap plaintext tokens for keychain refs. Reversible, with backups.")
    .option("--dry-run", "print the import plan without writing")
    .option("--write", "apply the import plan")
    .option("--cleanup-client", "remove direct MCP bypass routes from active project client config with backups")
    .option("--accept-direct <client:server>", "preserve an intentional direct MCP route as accepted risk", collectOption, [])
    .option("--json", "print machine-readable JSON")
    .action(
      async (options: { dryRun?: boolean; write?: boolean; cleanupClient?: boolean; acceptDirect?: string[]; json?: boolean }) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        if (options.write) {
          try {
            const result = await writeSwitchboardImportPlan({
              ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
              ...(options.cleanupClient ? { cleanupClient: true } : {}),
              ...(options.acceptDirect && options.acceptDirect.length > 0
                ? { acceptDirect: options.acceptDirect }
                : {})
            });
            const postWriteNextAction = await createPostWriteNextAction({
              cwd: result.plan.repo.cwd,
              secretStore
            });
            const displayResult = formatWrittenImportForDisplay(
              rewriteWrittenImportCommandsForCurrentInvocation(result),
              postWriteNextAction
            );
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
          ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
          ...(options.acceptDirect && options.acceptDirect.length > 0
            ? { acceptDirect: options.acceptDirect }
            : {})
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
    .description("Show which config and agent profiles are active in this repo.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const configOptions = optionsFromCwd(globalOptions.cwd);
      const loaded = loadSwitchboardConfig(configOptions);
      const repoPaths = resolveRepoConfigPaths(configOptions);

      // "Is a pass live right now?" is the first question status should
      // answer, so gather the repo's active passes up front. Use the
      // config-file location (not parse success) to anchor the repo path,
      // so a broken repo config can't make status miss a live pass.
      const repoPath = installTargetCwd(globalOptions.cwd);
      const mandateStorePath = io.mandateStorePath ?? resolveMandateStorePath();
      let activePasses: Array<{
        id: string;
        branch: string;
        agentRole: string;
        profiles: string[];
        allowedTools: string[];
        lease: string;
        expiresAt: string;
        grantedViaGrant: boolean;
      }> = [];
      let activePassesError: string | null = null;
      try {
        activePasses = (await listMandates({ path: mandateStorePath, repoPath }))
          .filter((mandate) => mandate.runtimeStatus === "active")
          .map((mandate) => ({
            id: mandate.id,
            branch: mandate.branch,
            agentRole: mandate.agentRole,
            profiles: mandate.profiles,
            allowedTools: mandate.allowedTools,
            lease: mandate.lease,
            expiresAt: mandate.expiresAt,
            grantedViaGrant: mandate.authoritySource?.ref === "grant"
          }));
      } catch (error) {
        // A corrupt mandate store must not crash the health command;
        // degrade to "unknown" and say so instead of guessing.
        activePassesError = mandateMessageInPassVocabulary(
          messageFromError(error)
        );
      }

      const status = {
        globalConfigPath: resolveGlobalConfigPath(),
        repoConfigPath: repoPaths.repoConfigPath ?? null,
        repoLocalConfigPath: repoPaths.repoLocalConfigPath ?? null,
        sources: loaded.sources,
        profileCount: Object.keys(loaded.config.profiles).length,
        workspaceCount: Object.keys(loaded.config.workspaces).length,
        namespaces: namespacesForProfiles(loaded.config.profiles),
        activePasses,
        activePassesError,
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
    .description("Check your setup and tell you the next thing to fix or run.")
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
    .description("Store your tokens in your OS keychain so they stay out of repo and client config.");

  secrets
    .command("set <ref>")
    .description("Save a token in your keychain under a ref your config can point to.")
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
        if (ref === secretStoreProbeRef) {
          writeCommandError({
            json: options.json,
            code: "reserved_secret_ref",
            message: `"${secretStoreProbeRef}" is reserved for the switchboard secrets doctor health check and cannot store a secret.`,
            nextActions: [
              "Choose a different ref such as github/findu/dev/token."
            ]
          });
          return;
        }
        if (!options.valueStdin && options.json) {
          writeCommandError({
            json: options.json,
            code: "missing_secret_input",
            message: "--value-stdin is required when using --json",
            nextActions: [
              `Pipe a secret value on stdin, for example: pbpaste | switchboard secrets set ${ref} --value-stdin`
            ]
          });
          return;
        }

        try {
          const value = options.valueStdin
            ? await readSecretFromStdin()
            : await readSecretFromPrompt(`Paste secret value for ${ref}: `);
          if (value.length === 0) {
            writeCommandError({
              json: options.json,
              code: "empty_secret",
              message: "secret value must not be empty",
              nextActions: options.valueStdin
                ? ["Pipe a non-empty secret value on stdin."]
                : [`Run switchboard secrets set ${ref} again and paste a non-empty value.`]
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
          await writeSecretBackendError(options.json, error, "secret_set_failed");
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
        await writeSecretBackendError(options.json, error, "secret_remove_failed");
      }
    });

  secrets
    .command("doctor")
    .description("Check your keychain and which configured tokens are set — never printing their values.")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
      const backend = await diagnoseSecretStore(secretStore);
      const probe = await probeSecretStore(secretStore);
      const backendHelp = probe.ok
        ? undefined
        : describeSecretBackendError(
            new Error(probe.error ?? "the secret store failed a read/write check"),
            secretBackendContextFromDiagnostic(backend)
          );
      // Skip the per-ref lookups when the store itself can't read/write —
      // they would all fail with the same underlying error and bury the cause.
      const missingSecrets = probe.ok
        ? await findMissingSecretRefs(loaded.config, secretStore)
        : [];
      const result = {
        ok:
          isSecretBackendDiagnosticOk(backend) &&
          probe.ok &&
          missingSecrets.length === 0 &&
          !loaded.diagnostics.some((item) => item.level === "error"),
        schemaVersion: secretsSchemaVersion,
        indexPath: resolveSecretIndexPath(
          secretIndexOptions(io.secretIndexPath)
        ),
        backend,
        backendReadWriteOk: probe.ok,
        ...(backendHelp ? { backendHelp } : {}),
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
    .description("Save a provider's token (like GitHub or Vercel) into your keychain, the easy way.")
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
        const configuredProfileName =
          profileNameForProviderSecretRef({
            cwd: program.opts<{ cwd?: string }>().cwd,
            provider: template.provider,
            secretRef: resolvedSecretRef
          }) ?? defaults.profileName;
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
          const unsafeSecret = validateProviderSecretValue(template.id, value);
          if (!unsafeSecret.ok) {
            writeCommandError({
              json: options.json,
              code: unsafeSecret.code,
              message: unsafeSecret.message,
              nextActions: unsafeSecret.nextActions
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
              `switchboard presets check ${template.id} --profile ${configuredProfileName}`,
              `switchboard pass create --from ${template.id}`
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
          if (message.includes("--value-stdin")) {
            writeCommandError({
              json: options.json,
              code: "provider_auth_failed",
              message,
              nextActions: [
                `Pipe the token with: pbpaste | ${formatHumanCommand(`switchboard auth ${preset} --value-stdin`)}`
              ]
            });
            return;
          }
          await writeSecretBackendError(
            options.json,
            error,
            "provider_auth_failed"
          );
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
          const plan = await createProviderAddPlan(planOptions);
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
          const unsafeSecret = validateProviderSecretValue(template.id, value);
          if (!unsafeSecret.ok) {
            writeCommandError({
              json: options.json,
              code: unsafeSecret.code,
              message: unsafeSecret.message,
              nextActions: unsafeSecret.nextActions
            });
            return;
          }

          let written: WrittenProviderAddPlan;
          let tokenStored = false;
          try {
            await secretStore.set(plan.rendered.secretRef, value);
            tokenStored = true;
            await rememberSecretRef(
              plan.rendered.secretRef,
              secretIndexOptions(io.secretIndexPath)
            );
            written = await writeProviderAddPlan(planOptions);
          } catch (error) {
            if (tokenStored) {
              await secretStore.delete(plan.rendered.secretRef).catch(() => undefined);
              await forgetSecretRef(
                plan.rendered.secretRef,
                secretIndexOptions(io.secretIndexPath)
              ).catch(() => undefined);
            }
            throw error;
          }
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
          if (message.includes("--value-stdin")) {
            writeCommandError({
              json: options.json,
              code: "provider_setup_failed",
              message,
              nextActions: [
                `Pipe the token with: pbpaste | ${formatHumanCommand(rewriteSwitchboardCommand(`switchboard setup ${preset} --value-stdin`, switchboardCommandPrefixForRepo(cwd)))}`
              ]
            });
            return;
          }
          await writeSecretBackendError(
            options.json,
            error,
            "provider_setup_failed"
          );
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
    .option("--timeout-ms <ms>", "MCP request timeout in milliseconds", "5000")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        id: string,
        options: {
          profile: string;
          timeoutMs: string;
          json?: boolean;
        }
      ) => {
        const timeoutMs = parseTimeoutMs(options.timeoutMs);
        if (timeoutMs === undefined) {
          writeCommandError({
            json: options.json,
            code: "invalid_timeout",
            message: "--timeout-ms must be a positive integer"
          });
          return;
        }
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
          const tools = await listToolsForProfiles([upstream], {
            auditLogger,
            timeoutMs
          });
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
    .option("--mandate <id>", "show tools through an active pass")
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
            "Run switchboard setup <preset> to add a provider profile.",
            "Run switchboard import --dry-run to inspect existing MCP configs."
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
        const message = messageFromError(error);
        writeCommandError({
          json: options.json,
          code: "tool_surface_failed",
          message,
          nextActions: toolSurfaceFailureNextActions(message, mandate?.id)
        });
      }
    });

  const authority = program
    .command("authority")
    .description("Draft and validate repo-scoped tool authority maps.");

  authority
    .command("draft")
    .description("Discover a profile tool surface and draft a conservative authority map.")
    .requiredOption("--profile <name>", "profile to discover and map")
    .option("--namespace <namespace>", "override the namespace recorded in the draft")
    .option("--json", "print machine-readable JSON")
    .action(
      async (options: {
        profile: string;
        namespace?: string;
        json?: boolean;
      }) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));

        if (!validateLoadedConfigForJsonCommand(loaded, options.json)) {
          return;
        }

        const profileConfig = loaded.config.profiles[options.profile];
        if (!profileConfig) {
          writeCommandError({
            json: options.json,
            code: "profile_not_found",
            message: `profile "${options.profile}" was not found`,
            nextActions: [
              "Run switchboard scan to inspect configured profiles.",
              "Run switchboard setup <preset> to add a provider profile."
            ]
          });
          return;
        }

        const profiles = await stdioProfilesFromConfigForCommand({
          profiles: { [options.profile]: profileConfig },
          cwdBase: configCwdBase(loaded, globalOptions.cwd),
          secretStore,
          json: options.json,
          writeCommandError,
          writeErr
        });
        if (!profiles) {
          return;
        }

        const selectedProfile = profiles[0];
        if (!selectedProfile) {
          writeCommandError({
            json: options.json,
            code: "profile_not_stdio",
            message: `profile "${options.profile}" does not have a stdio upstream tool surface`,
            nextActions: [
              "Run switchboard import --dry-run to inspect MCP configs.",
              "Run switchboard setup <preset> to add a stdio provider profile."
            ]
          });
          return;
        }

        try {
          const tools = await listToolsForProfiles([selectedProfile], {
            auditLogger
          });
          const draft = draftAuthorityMap({
            profileName: selectedProfile.profileName,
            namespace: options.namespace ?? selectedProfile.namespace,
            toolNames: tools.map((tool) => tool.name)
          });
          writeOut(
            options.json
              ? JSON.stringify(draft, null, 2)
              : formatAuthorityMapDraft(draft)
          );
        } catch (error) {
          writeCommandError({
            json: options.json,
            code: "authority_draft_failed",
            message: messageFromError(error),
            nextActions: [
              `Run switchboard test ${options.profile} to debug the upstream MCP profile.`,
              "Run switchboard tools --json to inspect the current tool surface."
            ]
          });
        }
      }
    );

  authority
    .command("check <file>")
    .description("Validate an authority map draft YAML or JSON file.")
    .option("--json", "print machine-readable JSON")
    .action((file: string, options: { json?: boolean }) => {
      try {
        const globalOptions = program.opts<{ cwd?: string }>();
        const filePath = isAbsolute(file)
          ? file
          : resolve(globalOptions.cwd ?? process.cwd(), file);
        const draft = parseAuthorityMapDraft(readFileSync(filePath, "utf8"));
        const result = checkAuthorityMapDraft(draft);
        writeOut(
          options.json
            ? JSON.stringify(result, null, 2)
            : formatAuthorityMapCheck(result)
        );
        if (!result.ok) {
          process.exitCode = 1;
        }
      } catch (error) {
        writeCommandError({
          json: options.json,
          code: "authority_map_check_failed",
          message: messageFromError(error),
          nextActions: [
            "Run switchboard authority draft --profile <name> --json to generate a schema-valid authority map."
          ]
        });
      }
    });

  const demo = program
    .command("demo")
    .description("Print local Switchboard demo command sequences.");

  demo
    .command("pass [profile]")
    .alias("mandate")
    .description("Print a local task-scoped pass demo for one stdio profile.")
    .option("--task <task>", "demo task name")
    .option("--agent <role>", "agent role for the demo pass", "implementer")
    .option("--branch <branch>", "branch to bind the demo pass")
    .option("--lease <duration>", "demo pass lease duration", "30m")
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
    .option("--mandate <id>", "bind routed tool calls to an active pass")
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
    .option("--mandate <id>", "bind routed tool calls to an active pass")
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
    .command("grant")
    .description("Give this repo's agent a scoped pass that expires on its own.")
    .option("--as <role>", "who the agent is acting as", "agent")
    .option("--for <duration>", "how long the pass lasts, like 30m, 2h, or 1d", "4h")
    .option(
      "--profiles <profiles>",
      "comma-separated profiles to include (default: every profile in this repo)"
    )
    .option("--json", "print machine-readable JSON")
    .action(
      async (options: {
        as: string;
        for: string;
        profiles?: string;
        json?: boolean;
      }) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
        if (!validateLoadedConfigForJsonCommand(loaded, options.json)) {
          return;
        }

        const allProfiles = Object.keys(loaded.config.profiles);
        const profiles = options.profiles
          ? parseCommaSeparatedList(options.profiles)
          : allProfiles;
        if (profiles.length === 0) {
          writeCommandError({
            json: options.json,
            code: "grant_no_profiles",
            message:
              "this repo has no configured profiles yet, so there is nothing to grant.",
            nextActions: [
              "Run switchboard scan to see what's here, then switchboard import to set it up."
            ]
          });
          return;
        }
        const missingProfiles = profiles.filter(
          (profile) => !loaded.config.profiles[profile]
        );
        if (missingProfiles.length > 0) {
          writeCommandError({
            json: options.json,
            code: "grant_profiles_not_found",
            message: `these profiles were not found: ${missingProfiles.join(", ")}`,
            nextActions: ["Run switchboard status to list configured profiles."]
          });
          return;
        }

        try {
          parseMandateLease(options.for);
        } catch (error) {
          writeCommandError({
            json: options.json,
            code: "grant_invalid_duration",
            message: messageFromError(error),
            nextActions: ["Use a duration like 30m, 2h, or 1d."]
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
            code: "grant_git_binding_failed",
            message: messageFromError(error),
            nextActions: ["Run switchboard grant from inside a git repository."]
          });
          return;
        }
        const branch = gitBinding?.branch ?? "main";

        // Scope the pass to exactly the tools of the included profiles.
        const namespaceByProfile = new Map(
          namespacesForProfiles(loaded.config.profiles).map((entry) => [
            entry.profile,
            entry.namespace
          ])
        );
        const allowedTools = profiles.map(
          (profile) => `${namespaceByProfile.get(profile) ?? profile}_*`
        );

        const agentRole = options.as.trim() || "agent";
        const path = io.mandateStorePath ?? resolveMandateStorePath();
        const authoritySource: MandateAuthoritySource = { type: "manual", ref: "grant" };
        const grantId = normalizeMandateId(`grant/${branch}`);

        // Friendly pre-check so we don't depend on a core error-message string.
        const alreadyActive = (await listMandates({ path, repoPath })).some(
          (mandate) =>
            mandate.id === grantId && mandate.runtimeStatus === "active"
        );
        if (alreadyActive) {
          writeCommandError({
            json: options.json,
            code: "grant_already_active",
            message: `this repo already has an active pass on "${branch}".`,
            nextActions: [
              "End it early with switchboard revoke, or wait for it to expire.",
              "See it with switchboard pass status."
            ]
          });
          return;
        }

        try {
          const mandate = await createMandate({
            path,
            task: `grant/${branch}`,
            repoPath,
            worktreePath: gitBinding?.worktreePath ?? repoPath,
            branch,
            agentRole,
            profiles,
            lease: options.for,
            allowedTools,
            createdBy: agentRole,
            authoritySource
          });

          // A pass only binds agents that are actually routed through
          // Switchboard; say so honestly when no client is wired up yet.
          // null means detection failed — unknown, not "none".
          let routedClients: string[] | null = null;
          try {
            const launch = resolveInstallLaunch({ commandArgs: [] });
            const clientConfigs = await inspectProjectClientConfigs({
              cwd: repoPath,
              command: launch.command,
              commandArgs: launch.commandArgs
            });
            routedClients = clientConfigs
              .filter((client) => client.status === "installed")
              .map((client) => client.client);
          } catch {
            // Detection is a courtesy; never let it break a successful grant.
          }

          if (options.json) {
            const mcpLaunch = createMandateMcpLaunchPayload(mandate);
            writeOut(
              JSON.stringify(
                {
                  path,
                  mandate,
                  workspaceLease: createWorkspaceLeasePayload(mandate, mcpLaunch),
                  // anyClientRouted only claims a client config routes
                  // through Switchboard — not that every path is governed.
                  // null = detection failed, routing status unknown.
                  enforcement: {
                    routedClients,
                    anyClientRouted:
                      routedClients === null ? null : routedClients.length > 0
                  }
                },
                null,
                2
              )
            );
          } else {
            const badge = formatGrantBadge(mandate, {
              secretRefs: grantSecretRefs(loaded.config, profiles),
              paint
            });
            // Only assert "nothing enforces this" on a confirmed zero;
            // a failed detection stays silent rather than stating a guess.
            const nudge =
              routedClients !== null && routedClients.length === 0
                ? [
                    "",
                    paint.yellow(
                      "Heads up: no agent client is routed through Switchboard here yet,"
                    ),
                    paint.yellow("so nothing enforces this pass. Wire one up with:"),
                    "  switchboard install claude   (or: switchboard install codex)"
                  ].join("\n")
                : "";
            writeOut(badge + nudge);
          }
        } catch (error) {
          const commandError = mandateCommandError(error, "grant_failed");
          writeCommandError({
            json: options.json,
            code: commandError.code,
            message: commandError.message,
            nextActions: commandError.nextActions
          });
        }
      }
    );

  program
    .command("revoke")
    .description("End this repo's active pass now, before it expires.")
    .argument("[id]", "revoke a specific pass by id (default: the pass on this branch)")
    .option("--json", "print machine-readable JSON")
    .action(async (id: string | undefined, options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const repoPath = installTargetCwd(globalOptions.cwd);
      const path = io.mandateStorePath ?? resolveMandateStorePath();
      const activeAll = (await listMandates({ path, repoPath })).filter(
        (mandate) => mandate.runtimeStatus === "active"
      );

      let target: (typeof activeAll)[number] | undefined;
      if (id) {
        // Explicit id: revoke exactly that active pass, whatever created it.
        target = activeAll.find((mandate) => mandate.id === normalizeMandateId(id));
        if (!target) {
          writeCommandError({
            json: options.json,
            code: "revoke_id_not_active",
            message: `no active pass with id "${normalizeMandateId(id)}" in this repo.`,
            nextActions:
              activeAll.length > 0
                ? [`Active passes: ${activeAll.map((m) => m.id).join(", ")}.`]
                : ["Give one out with switchboard grant."]
          });
          return;
        }
      } else {
        // Default: only ever auto-pick a grant-created pass on the current
        // branch, so revoke never silently cancels a different or hand-made
        // mandate for the same repo.
        let branch: string | undefined;
        try {
          branch = resolveGitWorktreeBinding(repoPath)?.branch;
        } catch {
          branch = undefined;
        }
        const grantPasses = activeAll.filter(
          (mandate) =>
            mandate.authoritySource?.ref === "grant" &&
            (branch === undefined || mandate.branch === branch)
        );
        if (grantPasses.length === 1) {
          target = grantPasses[0];
        } else if (grantPasses.length === 0) {
          writeCommandError({
            json: options.json,
            code: "revoke_nothing_active",
            message:
              branch === undefined
                ? "this repo has no active pass to revoke."
                : `this repo has no active pass on "${branch}" to revoke.`,
            nextActions:
              activeAll.length > 0
                ? [
                    `Other active passes: ${activeAll.map((m) => m.id).join(", ")}.`,
                    "Revoke one explicitly with switchboard revoke <id>."
                  ]
                : ["Give one out with switchboard grant."]
          });
          return;
        } else {
          writeCommandError({
            json: options.json,
            code: "revoke_ambiguous",
            message: `more than one active pass matches; choose one with switchboard revoke <id>.`,
            nextActions: [
              `Candidates: ${grantPasses.map((m) => m.id).join(", ")}.`
            ]
          });
          return;
        }
      }

      if (!target) {
        writeCommandError({
          json: options.json,
          code: "revoke_nothing_active",
          message: "this repo has no active pass to revoke.",
          nextActions: ["Give one out with switchboard grant."]
        });
        return;
      }

      try {
        const mandate = await updateMandateHandoff({
          path,
          id: target.id,
          repoPath,
          state: "cancelled",
          summary: "revoked via switchboard revoke"
        });
        writeOut(
          options.json
            ? JSON.stringify({ path, mandate }, null, 2)
            : `Revoked pass ${mandate.id} (${mandate.branch}). The agent's scoped access is off now.`
        );
      } catch (error) {
        const commandError = mandateCommandError(error, "revoke_failed");
        writeCommandError({
          json: options.json,
          code: commandError.code,
          message: commandError.message,
          nextActions: commandError.nextActions
        });
      }
    });

  program
    .command("pass")
    .alias("mandate")
    .description("Create and inspect the scoped passes agents work under.")
    .addCommand(
      new Command("create")
        .description("Create a local task-scoped pass.")
        .argument("[task]", "task name or summary")
        .option(
          "--from <preset>",
          "use a provider safety template to fill pass defaults and policy"
        )
        .option(
          "--from-authority <file>",
          "use a checked authority map draft file as the pass policy"
        )
        .option(
          "--accept-review",
          "acknowledge authority map warnings/review tools before creating the pass"
        )
        .option("--agent <role>", "agent role for this pass")
        .option(
          "--actor <name>",
          "human, harness, or client identity creating the pass"
        )
        .option(
          "--profiles <profiles>",
          "comma-separated Switchboard profiles to bind"
        )
        .option("--branch <branch>", "branch the pass is scoped to")
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
              fromAuthority?: string;
              acceptReview?: boolean;
              agent?: string;
              actor?: string;
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

            if (options.from && options.fromAuthority) {
              writeCommandError({
                json: options.json,
                code: "conflicting_mandate_sources",
                message: "use either --from <preset> or --from-authority <file>, not both",
                nextActions: [
                  "Use --from <preset> for curated provider templates.",
                  "Use --from-authority <file> for reviewed authority-map drafts."
                ]
              });
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

            const authorityMapResult = options.fromAuthority
              ? loadAuthorityMapForMandate({
                  file: options.fromAuthority,
                  ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
                  config: loaded.config,
                  ...(options.acceptReview
                    ? { acceptReview: options.acceptReview }
                    : {})
                })
              : undefined;
            if (authorityMapResult && !authorityMapResult.ok) {
              writeCommandError({
                json: options.json,
                code: authorityMapResult.error.code,
                message: authorityMapResult.error.message,
                nextActions: authorityMapResult.error.nextActions
              });
              return;
            }
            const authorityMap = authorityMapResult?.map;

            const profiles = parseCommaSeparatedList(
              options.profiles ??
                authorityMap?.profileName ??
                presetProfileDefaultForConfig(template, loaded.config) ??
                ""
            );
            if (
              authorityMap &&
              (profiles.length !== 1 || profiles[0] !== authorityMap.profileName)
            ) {
              writeCommandError({
                json: options.json,
                code: "authority_map_profile_mismatch",
                message: `authority map "${authorityMap.profileName}" can only create a pass for that one profile`,
                nextActions: [
                  `Use --profiles ${authorityMap.profileName} or omit --profiles.`,
                  "Create separate authority maps for additional profiles."
                ]
              });
              return;
            }
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
                message: `missing required pass option(s): ${missingRequired.join(", ")}`,
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
                message: `pass profiles were not found: ${missingProfiles.join(", ")}`,
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
                message: "missing required pass option(s): --branch",
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
                message: `pass branch "${branch}" does not match current git branch "${gitBinding.branch}" in ${gitBinding.worktreePath}`,
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
            const authorityPolicy = authorityMap?.draft.suggestedMandatePolicy;
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

            const authoritySource: MandateAuthoritySource = template
              ? { type: "preset", ref: template.id }
              : authorityMap
                ? { type: "authority-map", ref: authorityMap.sourcePath }
                : { type: "manual" };

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
                ...(options.actor ? { createdBy: options.actor } : {}),
                authoritySource,
                allowedTools: [
                  ...(templatePolicy?.allowedTools ?? []),
                  ...(authorityPolicy?.allowedTools ?? []),
                  ...options.allowTool
                ],
                deniedTools: [
                  ...(templatePolicy?.deniedTools ?? []),
                  ...(authorityPolicy?.deniedTools ?? []),
                  ...options.denyTool
                ],
                approvalRequiredTools: [
                  ...(templatePolicy?.approvalGates ?? []),
                  ...(authorityPolicy?.approvalGates ?? []),
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
                      ...(authorityMap
                        ? {
                            authorityMap: authorityMapMandateMetadata(
                              authorityMap
                            )
                          }
                        : {}),
                      mcpLaunch,
                      workspaceLease: createWorkspaceLeasePayload(mandate, mcpLaunch)
                    },
                    null,
                    2
                  )
                );
              } else {
                writeOut(
                  formatMandateCreatedFromAuthority(
                    formatMandateCreated(path, mandate),
                    authorityMap
                  )
                );
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
        .description("Create a child pass narrowed from an active parent.")
        .argument("<task>", "child task name or summary")
        .requiredOption("--parent <id>", "active parent pass id")
        .requiredOption("--agent <role>", "agent role for this child pass")
        .requiredOption(
          "--profiles <profiles>",
          "comma-separated Switchboard profiles to bind"
        )
        .requiredOption("--branch <branch>", "branch the child pass is scoped to")
        .requiredOption("--lease <duration>", "lease duration, like 30m, 2h, or 1d")
        .option("--delegated-by <actor>", "actor creating the child pass")
        .option(
          "--actor <name>",
          "human, harness, or client identity creating the child pass (defaults to --delegated-by)"
        )
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
              actor?: string;
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
                message: `child pass profiles were not found: ${missingProfiles.join(", ")}`,
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
                message: `child pass branch "${branch}" does not match current git branch "${gitBinding.branch}" in ${gitBinding.worktreePath}`,
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
                ...(options.actor ?? options.delegatedBy
                  ? { createdBy: options.actor ?? options.delegatedBy }
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
        .description("Close a pass with a local handoff report.")
        .argument("<id>", "pass id to hand off")
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
                    message: `cannot hand off pass "${normalizeMandateId(id)}" while readiness blockers remain: ${report.readiness.blockers.join("; ")}. Use --ignore-readiness to close anyway.`,
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
        .description("Build a local escalation plan for a pass tree.")
        .argument("<id>", "root or child pass id to escalate")
        .option("--json", "print machine-readable JSON")
        .option("--all", "search passes for all repos")
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
        .description("Renew an open pass lease from now.")
        .argument("<id>", "pass id to renew")
        .requiredOption("--lease <duration>", "new lease duration, like 30m, 2h, or 1d")
        .option(
          "--actor <name>",
          "human, harness, or client identity renewing the lease"
        )
        .option("--json", "print machine-readable JSON")
        .action(
          async (
            id: string,
            options: { lease: string; actor?: string; json?: boolean }
          ) => {
            const globalOptions = program.opts<{ cwd?: string }>();
            const repoPath = installTargetCwd(globalOptions.cwd);
            const path = io.mandateStorePath ?? resolveMandateStorePath();
            try {
              const mandate = await renewMandate({
                path,
                id,
                repoPath,
                lease: options.lease,
                ...(options.actor ? { actor: options.actor } : {})
              });
              const result = { path, mandate };
              const renewals = (mandate.leaseEvents ?? []).filter(
                (event) => event.type === "renewed"
              ).length;
              writeOut(
                options.json
                  ? JSON.stringify(result, null, 2)
                  : [
                      `Renewed pass ${mandate.id}`,
                      `Runtime: ${mandate.runtimeStatus}`,
                      `Lease: ${mandate.lease}`,
                      `Expires: ${mandate.expiresAt}`,
                      `Renewals: ${renewals}`,
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
        .description("Show a pass tree handoff report.")
        .argument("<id>", "root or child pass id to report")
        .option("--json", "print machine-readable JSON")
        .option("--all", "search passes for all repos")
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
        .description("Show local task-scoped passes.")
        .argument("[id]", "pass id to inspect")
        .option("--json", "print machine-readable JSON")
        .option("--all", "show passes for all repos")
        .option("--verbose", "show detailed policy and delegation fields")
        .action(
          async (
            id: string | undefined,
            options: { json?: boolean; all?: boolean; verbose?: boolean }
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
                message: mandateMessageInPassVocabulary(messageFromError(error))
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
                message: `pass "${id}" was not found`,
                nextActions: [
                  "Run switchboard pass status to list passes for this repo."
                ]
              });
              return;
            }

            if (options.json) {
              writeOut(JSON.stringify(result, null, 2));
            } else {
              writeOut(
                formatMandateStatus(result, options.verbose ? { verbose: true } : {})
              );
            }
          }
        )
    );

  program
    .command("approvals")
    .description("Show approval requests for this repo's passes.")
    .option("--json", "print machine-readable JSON")
    .option("--all", "show approval requests for all repos")
    .option("--mandate <id>", "filter approval requests by pass id")
    .option(
      "--include-children",
      "with --mandate, include approval requests for child passes"
    )
    .option(
      "--status <status>",
      "filter by runtime status: pending, approved, denied, stale, or expired"
    )
    .option("--watch", "keep watching approval requests until interrupted")
    .option("--interval <duration>", "watch polling interval, like 2s or 1m")
    .option("--timeout <duration>", "stop watch mode after a duration, or 0 for one snapshot")
    .action(
      async (options: {
        json?: boolean;
        all?: boolean;
        mandate?: string;
        includeChildren?: boolean;
        status?: "pending" | "approved" | "denied" | "stale" | "expired";
        watch?: boolean;
        interval?: string;
        timeout?: string;
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
        if (!options.watch && (options.interval || options.timeout)) {
          writeCommandError({
            json: options.json,
            code: "invalid_watch_options",
            message: "--interval and --timeout require --watch",
            nextActions: [
              "Add --watch, or remove --interval and --timeout."
            ]
          });
          return;
        }
        const watchInterval = parseWatchDurationForCommand(
          options.interval,
          "--interval",
          { defaultMs: 2_000, minMs: 1_000, maxMs: 60_000, allowZero: false }
        );
        if (!watchInterval.ok) {
          writeCommandError({
            json: options.json,
            code: "invalid_watch_duration",
            message: watchInterval.message,
            nextActions: watchInterval.nextActions
          });
          return;
        }
        if (watchInterval.value === null) {
          writeCommandError({
            json: options.json,
            code: "invalid_watch_interval",
            message: "--interval requires a duration like 2s or 1m",
            nextActions: ["Pass --interval 2s, or omit --interval."]
          });
          return;
        }
        const watchTimeout = parseWatchDurationForCommand(
          options.timeout,
          "--timeout",
          { minMs: 0, maxMs: 86_400_000, allowZero: true }
        );
        if (!watchTimeout.ok) {
          writeCommandError({
            json: options.json,
            code: "invalid_watch_duration",
            message: watchTimeout.message,
            nextActions: watchTimeout.nextActions
          });
          return;
        }
        if (options.watch && options.json && watchTimeout.value === null) {
          writeCommandError({
            json: options.json,
            code: "missing_watch_timeout",
            message: "--watch --json requires --timeout so the JSON payload can finish",
            nextActions: [
              "Pass --timeout 0 for one JSON snapshot, or a bounded duration like --timeout 30s."
            ]
          });
          return;
        }
        if (
          options.watch &&
          options.json &&
          watchTimeout.value !== null &&
          watchTimeout.value > 600_000
        ) {
          writeCommandError({
            json: options.json,
            code: "watch_timeout_too_long",
            message: "--watch --json buffers snapshots and must use --timeout 10m or less",
            nextActions: [
              "Use --timeout 0 for one snapshot, or poll with shorter bounded windows."
            ]
          });
          return;
        }
        const path = io.approvalStorePath ?? resolveApprovalRequestStorePath();
        const mandateStorePath = io.mandateStorePath ?? resolveMandateStorePath();
        try {
          const payloadOptions: ApprovalRequestsPayloadOptions = {
            path,
            mandateStorePath,
            ...(repoPath ? { repoPath } : {}),
            ...(options.mandate ? { mandateId: options.mandate } : {}),
            includeChildren: options.includeChildren ?? false,
            ...(options.status ? { status: options.status } : {})
          };

          if (options.watch) {
            await watchApprovalRequests({
              payloadOptions,
              intervalMs: watchInterval.value,
              timeoutMs: watchTimeout.value,
              json: options.json ?? false,
              writeOut
            });
            return;
          }

          const result = await createApprovalRequestsPayload(payloadOptions);
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
    .description("Approve a pending approval request from a pass.")
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
    .description("Deny a pending approval request from a pass.")
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
    .option("--mandate <id>", "filter entries by pass id")
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
      "Point Claude Code or Codex at Switchboard: prints the MCP client config, or writes it with --write (with a backup)."
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

function formatExpiresIn(expiresAt: string): string {
  const remainingMs = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remainingMs)) {
    return `expires ${expiresAt}`;
  }
  if (remainingMs <= 0) {
    return "expiring now";
  }
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (minutes < 60) {
    return `expires in ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0
      ? `expires in ${hours}h ${rest}m`
      : `expires in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0
    ? `expires in ${days}d ${restHours}h`
    : `expires in ${days}d`;
}

function formatStatus(status: {
  globalConfigPath: string;
  repoConfigPath: string | null;
  repoLocalConfigPath: string | null;
  profileCount: number;
  workspaceCount: number;
  namespaces: Array<{ profile: string; namespace: string; generated: boolean }>;
  activePasses: Array<{
    id: string;
    branch: string;
    agentRole: string;
    lease: string;
    expiresAt: string;
  }>;
  activePassesError: string | null;
  diagnostics: Array<{ level: string; message: string }>;
}): string {
  const lines = ["Switchboard status"];

  // Answer "is a pass live right now?" before anything else.
  if (status.activePassesError !== null) {
    lines.push(
      `Active passes: unknown (pass store unreadable: ${status.activePassesError})`
    );
  } else if (status.activePasses.length === 0) {
    lines.push(
      "Active passes: none (give one out with switchboard grant)"
    );
  } else {
    lines.push("Active passes:");
    for (const pass of status.activePasses) {
      lines.push(
        `  ${pass.id} · ${pass.branch} · acting as ${pass.agentRole} · ${formatExpiresIn(pass.expiresAt)} (${pass.expiresAt})`
      );
    }
  }

  lines.push(
    "",
    `Global config: ${status.globalConfigPath}`,
    `Repo config: ${status.repoConfigPath ?? "not found"}`,
    `Repo local config: ${status.repoLocalConfigPath ?? "not found"}`,
    `Profiles: ${status.profileCount}`,
    `Workspaces: ${status.workspaceCount}`
  );

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
  lines.push(`- authority: ${formatAuthorityStatusLabel(result.authorityStatus)}`);
  lines.push(`  ${result.authorityStatus.summary}`);

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

  if (result.riskFindings.length > 0) {
    lines.push(
      "",
      "Risk findings:",
      ...result.riskFindings.map(formatRiskFindingLine)
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

async function createRepoAuditForCurrentInvocation(
  program: Command
): Promise<RepoAuditResult> {
  const globalOptions = program.opts<{ cwd?: string }>();
  const launch = resolveInstallLaunch({ commandArgs: [] });
  const scan = await scanSwitchboardProject({
    ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
    command: launch.command,
    commandArgs: launch.commandArgs
  });
  const displayScan = rewriteScanCommandsForCurrentInvocation(scan);
  return createRepoAudit(displayScan);
}

function formatRepoAudit(result: RepoAuditResult): string {
  const lines = [
    `Switchboard audit: ${result.status}`,
    result.summary,
    "",
    "Repo:",
    `- path: ${result.repo.gitRoot ?? result.repo.cwd}`,
    `- branch: ${result.repo.branch ?? "unknown"}`,
    `- authority: ${formatAuthorityStatusLabel(result.authorityStatus)}`,
    "",
    "Findings:",
    `- bypasses: ${result.findingSummary.bypasses}`,
    `- risks: ${result.findingSummary.risks}`,
    `- warnings: ${result.findingSummary.warnings}`,
    `- direct client servers: ${result.findingSummary.directClientServers}`,
    `- switchboard profiles: ${result.findingSummary.switchboardProfiles}`,
    `- severity: critical ${result.findingSummary.critical}, high ${result.findingSummary.high}, medium ${result.findingSummary.medium}, info ${result.findingSummary.info}`,
    "",
    "Checks:"
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.status}: ${check.title}`);
    lines.push(`  ${check.summary}`);
    for (const evidence of check.evidence.slice(0, 3)) {
      lines.push(`  evidence: ${evidence}`);
    }
    if (check.nextActions.length > 0) {
      lines.push(`  fix: ${formatHumanCommand(check.nextActions[0] as string)}`);
    }
  }

  if (result.recommendedNextAction.primary) {
    lines.push("", "Recommended next:");
    lines.push(
      `- ${formatHumanCommand(result.recommendedNextAction.primary.command)}`
    );
    lines.push(`  ${result.recommendedNextAction.primary.reason}`);
  }

  return lines.join("\n");
}

interface RepoAuditExportInclude {
  mandates: boolean;
  approvals: boolean;
  logs: boolean;
}

interface RepoAuditExportEvidence {
  include: RepoAuditExportInclude;
  mandates: MandateWithStatus[];
  approvals: ApprovalRequestWithStatus[];
  logEntries: AuditLogEntry[];
  logCounts: { matched: number; exported: number } | null;
}

function parseAuditExportInclude(
  value: string | undefined
):
  | { ok: true; sections: RepoAuditExportInclude }
  | { ok: false; message: string } {
  const sections: RepoAuditExportInclude = {
    mandates: false,
    approvals: false,
    logs: false
  };
  for (const raw of (value ?? "").split(",")) {
    const section = raw.trim().toLowerCase();
    if (!section) {
      continue;
    }
    if (section === "all") {
      return {
        ok: true,
        sections: { mandates: true, approvals: true, logs: true }
      };
    }
    if (section === "mandates" || section === "approvals" || section === "logs") {
      sections[section] = true;
      continue;
    }
    return {
      ok: false,
      message: `unknown --include section "${section}"; use mandates, approvals, logs, or all`
    };
  }

  return { ok: true, sections };
}

async function collectRepoAuditExportEvidence(options: {
  repoPath: string;
  include: RepoAuditExportInclude;
  logLimit: number;
  mandateStorePath: string;
  approvalStorePath: string;
  auditLogPath: string;
}): Promise<RepoAuditExportEvidence> {
  const mandates = options.include.mandates
    ? await listMandates({
        path: options.mandateStorePath,
        repoPath: options.repoPath
      })
    : [];
  const approvals = options.include.approvals
    ? await listApprovalRequests({
        path: options.approvalStorePath,
        repoPath: options.repoPath
      })
    : [];
  let logEntries: AuditLogEntry[] = [];
  let logCounts: RepoAuditExportEvidence["logCounts"] = null;
  if (options.include.logs) {
    const matched = (
      await readAuditLogEntries({ path: options.auditLogPath })
    ).filter((entry) => entry.repoPath === options.repoPath);
    logEntries = matched.slice(Math.max(matched.length - options.logLimit, 0));
    logCounts = { matched: matched.length, exported: logEntries.length };
  }

  return {
    include: options.include,
    mandates,
    approvals,
    logEntries,
    logCounts
  };
}

function formatRepoAuditJsonl(
  result: RepoAuditResult,
  evidence?: RepoAuditExportEvidence
): string {
  const repo = {
    cwd: result.repo.cwd,
    gitRoot: result.repo.gitRoot,
    branch: result.repo.branch
  };
  const lines: Array<Record<string, unknown>> = [
    {
      schemaVersion: repoAuditExportSchemaVersion,
      type: "summary",
      generatedAt: new Date().toISOString(),
      status: result.status,
      repo: result.repo,
      authorityStatus: result.authorityStatus,
      findingSummary: result.findingSummary,
      recommendedNextAction: result.recommendedNextAction.primary ?? null,
      nextActions: result.nextActions,
      ...(evidence
        ? {
            evidenceCounts: {
              mandates: evidence.include.mandates
                ? evidence.mandates.length
                : null,
              approvals: evidence.include.approvals
                ? evidence.approvals.length
                : null,
              logEntries: evidence.logCounts
            }
          }
        : {})
    },
    ...result.checks.map((check) => ({
      schemaVersion: repoAuditExportSchemaVersion,
      type: "check",
      repo,
      auditStatus: result.status,
      check
    })),
    ...(evidence?.mandates ?? []).map((mandate) => ({
      schemaVersion: repoAuditExportSchemaVersion,
      type: "mandate",
      repo,
      mandate
    })),
    ...(evidence?.approvals ?? []).map((approvalRequest) => ({
      schemaVersion: repoAuditExportSchemaVersion,
      type: "approval_request",
      repo,
      approvalRequest
    })),
    ...(evidence?.logEntries ?? []).map((entry) => ({
      schemaVersion: repoAuditExportSchemaVersion,
      type: "audit_log",
      repo,
      entry
    }))
  ];
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

interface RepoManifest {
  schemaVersion: typeof repoManifestSchemaVersion;
  generatedAt: string;
  repo: SwitchboardScanResult["repo"];
  runtime: SwitchboardScanResult["runtime"];
  config: {
    valid: boolean;
    sources: SwitchboardScanResult["switchboard"]["configSources"];
    diagnostics: ReturnType<typeof loadSwitchboardConfig>["diagnostics"];
    namespaceCollisions: ReturnType<typeof loadSwitchboardConfig>["namespaceCollisions"];
  };
  authorityStatus: SwitchboardScanResult["authorityStatus"];
  audit: Pick<RepoAuditResult, "status" | "summary" | "findingSummary">;
  profiles: Array<{
    name: string;
    provider: string;
    namespace: string;
    environment: string | null;
    upstreamType: string | null;
    secretRefs: string[];
  }>;
  clients: Array<{
    client: SupportedClient;
    targetPath: string;
    status: string;
    message: string;
    directServerNames: string[];
    installCommand: string;
    rendered: {
      serverName: string;
      target: string;
      content: string;
    } | null;
  }>;
  diff: ManifestRouteDiff;
  secrets: {
    usages: ReturnType<typeof collectSecretRefUsages>;
    missing: MissingSecretRef[];
  };
  nextActions: {
    recommended: RecommendedNextAction["primary"];
    commands: string[];
  };
  safetyNotes: string[];
}

async function createRepoManifestForCurrentInvocation(
  program: Command,
  options: { secretStore: SecretStore }
): Promise<RepoManifest> {
  const globalOptions = program.opts<{ cwd?: string }>();
  const launch = resolveInstallLaunch({ commandArgs: [] });
  const scan = await scanSwitchboardProject({
    ...(globalOptions.cwd ? { cwd: globalOptions.cwd } : {}),
    command: launch.command,
    commandArgs: launch.commandArgs
  });
  const displayScan = rewriteScanCommandsForCurrentInvocation(scan);
  const audit = createRepoAudit(displayScan);
  const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
  const cwd = configCwdBase(loaded, globalOptions.cwd);
  const namespaceByProfile = new Map(
    namespacesForProfiles(loaded.config.profiles).map((entry) => [
      entry.profile,
      entry.namespace
    ])
  );
  const secretUsages = collectSecretRefUsages(loaded.config);
  const missingSecrets = await findMissingSecretRefs(
    loaded.config,
    options.secretStore
  );
  const configValid = !loaded.diagnostics.some(
    (diagnostic) => diagnostic.level === "error"
  );
  const manifestClients = createManifestClientEntries({
    scan: displayScan,
    cwd,
    launch,
    configValid
  });

  return {
    schemaVersion: repoManifestSchemaVersion,
    generatedAt: new Date().toISOString(),
    repo: displayScan.repo,
    runtime: displayScan.runtime,
    config: {
      valid: configValid,
      sources: displayScan.switchboard.configSources,
      diagnostics: loaded.diagnostics,
      namespaceCollisions: loaded.namespaceCollisions
    },
    authorityStatus: displayScan.authorityStatus,
    audit: {
      status: audit.status,
      summary: audit.summary,
      findingSummary: audit.findingSummary
    },
    profiles: Object.entries(loaded.config.profiles).map(([name, profile]) => ({
      name,
      provider: profile.provider,
      namespace: profile.namespace ?? namespaceByProfile.get(name) ?? name,
      environment: profile.environment ?? null,
      upstreamType: profile.upstream?.type ?? null,
      secretRefs: secretUsages
        .filter((usage) => usage.profileName === name)
        .map((usage) => usage.ref)
    })),
    clients: manifestClients,
    diff: diffManifestClientRoutes({
      clients: manifestClients.map((client) => ({
        client: client.client,
        status: client.status,
        directServerNames: client.directServerNames,
        renderedAvailable: client.rendered !== null
      })),
      acceptedDirectRisks: loaded.config.acceptedRisks.directMcp.map((risk) => ({
        client: risk.client,
        serverName: risk.serverName
      })),
      configValid
    }),
    secrets: {
      usages: secretUsages,
      missing: missingSecrets
    },
    nextActions: {
      recommended: displayScan.recommendedNextAction.primary,
      commands: displayScan.nextActions
    },
    safetyNotes: [
      "This manifest is a local Switchboard authority view, not a sandbox.",
      "Rendered client config routes agents through Switchboard MCP; direct clients, raw provider CLIs, browsers, and unrestricted shell access can bypass it.",
      "Secret refs are listed by name only; raw secret values are never included."
    ]
  };
}

function createManifestClientEntries(options: {
  scan: SwitchboardScanResult;
  cwd: string;
  launch: ReturnType<typeof resolveInstallLaunch>;
  configValid: boolean;
}): RepoManifest["clients"] {
  const byClient = new Map(
    options.scan.clients.map((client) => [client.client, client] as const)
  );
  return (["codex", "claude"] as SupportedClient[]).map((client) => {
    const scanClient = byClient.get(client);
    let rendered: RepoManifest["clients"][number]["rendered"] = null;
    if (options.configValid) {
      try {
        const config = renderSwitchboardClientConfig({
          client,
          command: options.launch.command,
          commandArgs: options.launch.commandArgs,
          cwd: options.cwd
        });
        rendered = {
          serverName: config.serverName,
          target: config.target,
          content: config.content
        };
      } catch {
        rendered = null;
      }
    }
    return {
      client,
      targetPath: scanClient?.targetPath ?? resolveProjectClientConfigPathSafe(client, options.cwd),
      status: scanClient?.status ?? "missing",
      message: scanClient?.message ?? `${client} project config is missing.`,
      directServerNames: scanClient?.otherServerNames ?? [],
      installCommand: `switchboard install ${client} --write`,
      rendered
    };
  });
}

function resolveProjectClientConfigPathSafe(
  client: SupportedClient,
  cwd: string
): string {
  return client === "codex"
    ? resolve(cwd, ".codex", "config.toml")
    : resolve(cwd, ".mcp.json");
}

function formatRepoManifest(manifest: RepoManifest): string {
  const lines = [
    `Switchboard repo manifest: ${manifest.repo.name}`,
    `Authority: ${formatAuthorityStatusLabel(manifest.authorityStatus)}`,
    manifest.authorityStatus.summary,
    `Audit: ${manifest.audit.status}`,
    "",
    "Repo:",
    `- path: ${manifest.repo.gitRoot ?? manifest.repo.cwd}`,
    `- branch: ${manifest.repo.branch ?? "unknown"}`,
    `- runtime: ${formatManifestRuntime(manifest)}`,
    "",
    "Config:",
    `- valid: ${manifest.config.valid ? "yes" : "no"}`,
    `- sources: ${manifest.config.sources.length}`,
    `- diagnostics: ${manifest.config.diagnostics.length}`,
    "",
    "Profiles:",
    ...(manifest.profiles.length > 0
      ? manifest.profiles.map(
          (profile) =>
            `- ${profile.name}: ${profile.provider}, namespace ${profile.namespace}, upstream ${profile.upstreamType ?? "none"}`
        )
      : ["- none"])
  ];

  lines.push("", "Clients:");
  for (const client of manifest.clients) {
    lines.push(`- ${client.client}: ${client.status}`);
    lines.push(`  target: ${client.targetPath}`);
    lines.push(`  install: ${formatHumanCommand(client.installCommand)}`);
    if (client.directServerNames.length > 0) {
      lines.push(`  direct routes: ${client.directServerNames.join(", ")}`);
    }
  }

  lines.push("", `Route drift: ${manifest.diff.status}`);
  for (const client of manifest.diff.clients) {
    lines.push(`- ${client.client}: ${client.status}`);
    for (const finding of client.findings) {
      lines.push(`  ${finding.severity}: ${finding.message}`);
      if (finding.resolveCommand) {
        lines.push(`    resolve: ${formatHumanCommand(finding.resolveCommand)}`);
      }
    }
  }

  lines.push("", "Secrets:");
  lines.push(`- refs used: ${manifest.secrets.usages.length}`);
  lines.push(`- missing: ${manifest.secrets.missing.length}`);
  for (const missing of manifest.secrets.missing.slice(0, 5)) {
    lines.push(`  - ${missing.ref}: ${missing.message}`);
  }

  if (manifest.nextActions.recommended) {
    lines.push("", "Recommended next:");
    lines.push(
      `- ${formatHumanCommand(manifest.nextActions.recommended.command)}`
    );
    lines.push(`  ${manifest.nextActions.recommended.reason}`);
  }

  lines.push(
    "",
    "Safety notes:",
    ...manifest.safetyNotes.map((note) => `- ${note}`)
  );

  return lines.join("\n");
}

function formatManifestRuntime(manifest: RepoManifest): string {
  const labels: string[] = [manifest.runtime.kind];
  if (manifest.runtime.devcontainerPresent) {
    labels.push("devcontainer present");
  }
  if (manifest.runtime.vercelProjectPresent) {
    labels.push("Vercel project linked");
  }
  return labels.join(", ");
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
    riskFindings: result.riskFindings.map((finding) =>
      rewriteRiskFindingCommands(finding, prefix)
    ),
    authorityStatus: rewriteAuthorityStatus(result.authorityStatus, prefix),
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
    riskFindings: plan.riskFindings.map((finding) =>
      rewriteRiskFindingCommands(finding, prefix)
    ),
    authorityStatus: rewriteAuthorityStatus(plan.authorityStatus, prefix),
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

function rewriteAuthorityStatus(
  status: AuthorityStatus,
  prefix: string
): AuthorityStatus {
  if (!status.recommendedAction || prefix === "switchboard") {
    return status;
  }

  return {
    ...status,
    recommendedAction: rewriteCommandShape(status.recommendedAction, prefix)
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

function nextActionCommands(action: RecommendedNextAction): string[] {
  return uniqueStrings(
    recommendedNextActionCandidates(action).map((candidate) => candidate.command)
  );
}

async function createPostWriteNextAction(options: {
  cwd: string;
  secretStore: SecretStore;
}): Promise<RecommendedNextAction | undefined> {
  try {
    return await createNextActionResult(options);
  } catch {
    return undefined;
  }
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
    lines.push(formatScanClientRoute(client));
    for (const name of client.otherServerNames) {
      lines.push(
        `${capitalize(client.client)} direct MCP server "${name}" detected`
      );
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

function formatScanClientRoute(client: {
  client: "codex" | "claude";
  status: string;
}): string {
  const name = capitalize(client.client);
  if (client.status === "missing") {
    return `${name} Switchboard route missing`;
  }
  if (client.status === "installed") {
    return `${name} Switchboard route installed`;
  }
  if (client.status === "stale") {
    return `${name} Switchboard route stale`;
  }
  if (client.status === "invalid") {
    return `${name} project MCP config invalid`;
  }
  return `${name} project MCP config ${client.status}`;
}

function formatImportPlan(plan: SwitchboardImportPlan): string {
  const lines = [
    `Switchboard import plan for ${plan.repo.name}`,
    "Dry run: no files were written.",
    `Authority status: ${formatAuthorityStatusLabel(plan.authorityStatus)}`,
    plan.authorityStatus.summary,
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

  if (plan.riskFindings.length > 0) {
    lines.push(
      "",
      "Risk findings:",
      ...plan.riskFindings.map(formatRiskFindingLine)
    );
  }

  const beforeLines = formatImportBeforeLines(plan);
  if (beforeLines.length > 0) {
    lines.push("", "Before:", ...beforeLines.map((line) => `- ${line}`));
  }

  const afterLines = formatImportAfterLines(plan);
  if (afterLines.length > 0) {
    lines.push(
      "",
      "Switchboard can change this to:",
      ...afterLines.map((line) => `- ${line}`)
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

type ImportWriteDisplayResult = WrittenSwitchboardImportPlan & {
  postWriteNextActions?: string[];
};

function formatWrittenImportForDisplay(
  result: WrittenSwitchboardImportPlan,
  postWriteNextAction: RecommendedNextAction | undefined
): ImportWriteDisplayResult {
  if (!postWriteNextAction) {
    return result;
  }

  const postWriteNextActions = nextActionCommands(postWriteNextAction);
  return {
    ...result,
    plan: {
      ...result.plan,
      recommendedNextAction: postWriteNextAction,
      nextActions: postWriteNextActions
    },
    postWriteNextActions
  };
}

function importWriteNextActions(result: ImportWriteDisplayResult): string[] {
  return result.postWriteNextActions ?? result.plan.nextActions;
}

function formatImportWriteJson(
  result: ImportWriteDisplayResult
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
    nextActions: importWriteNextActions(result),
    nextContent: result.nextContent
  };
}

function formatImportWrite(result: ImportWriteDisplayResult): string {
  const cleanupUpdated = result.clientCleanup.some(
    (item) => item.status === "updated"
  );
  const nextActions = importWriteNextActions(result);
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
      ...nextActions.map((action) => `- ${formatHumanCommand(action)}`)
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
    `Authority status: ${formatAuthorityStatusLabel(result.plan.authorityStatus)}`,
    result.plan.authorityStatus.summary,
    "",
    "Changed:",
    "- Created Switchboard profiles for existing project MCP servers.",
    "- Stored secret-looking env names as local token aliases in config.",
    result.clientCleanup.some((item) => item.status === "updated")
      ? "- Removed direct MCP bypass routes from active Codex/Claude project config with backups."
      : "- Left Codex and Claude client config untouched.",
    "- Kept raw secret values out of Switchboard config and active cleaned client config.",
    "- Preserved rollback backups as exact copies; keep them local because they may contain original raw token values.",
    "",
    "Next:",
    ...nextActions.map((action) => `- ${formatHumanCommand(action)}`)
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

function formatAuthorityStatusLabel(authorityStatus: AuthorityStatus): string {
  return authorityStatus.status;
}

function formatImportBeforeLines(plan: SwitchboardImportPlan): string[] {
  const lines: string[] = [];
  for (const finding of plan.bypassFindings) {
    const tags = finding.riskTags.join(", ");
    lines.push(
      `${capitalize(finding.client)} ${finding.serverName} direct MCP: ${tags}`
    );
  }
  for (const finding of plan.riskFindings) {
    const evidence =
      finding.evidence.length > 0 ? `: ${finding.evidence.join(", ")}` : "";
    lines.push(`${finding.kind}${evidence}`);
  }
  return lines;
}

function formatImportAfterLines(plan: SwitchboardImportPlan): string[] {
  const lines: string[] = [];
  if (
    plan.detected.clients.some((client) =>
      client.servers.some((server) => server.routesThroughSwitchboard)
    ) ||
    plan.commands.installClients.length > 0
  ) {
    lines.push("one Switchboard MCP endpoint per installed project client");
  }
  const profiles = plan.actions
    .filter((action) => action.kind === "create-profile" && action.profileName)
    .map((action) => action.profileName as string);
  if (profiles.length > 0) {
    lines.push(`${profiles.join(", ")} profile(s) behind local secretRefs`);
  }
  const cleanupTargets = plan.cleanupPlan
    .filter((item) => item.status === "planned")
    .flatMap((item) => item.affectedServerNames);
  if (cleanupTargets.length > 0) {
    lines.push("direct client routes removed from active config with backups");
    lines.push("timestamped rollback command for each modified client config");
  }
  if (plan.bypassFindings.some((finding) => finding.status === "accepted")) {
    lines.push("accepted direct routes preserved but kept visible as risk");
  }
  if (lines.length === 0) {
    lines.push("a reviewed setup plan without writing files");
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
  authorityStatus: AuthorityStatus;
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
      ok: bypassFindings.every((finding) => finding.status === "accepted"),
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
  const rawRecommendedNextAction = planRecommendedNextAction(
    doctorNextActionCandidates({
      loaded,
      localIgnoreOk: localIgnore.ok,
      clientConfigs,
      clientLaunches,
      missingSecrets,
      bypassFindings,
      nextSteps
    })
  );
  const commandPrefix = switchboardCommandPrefixForRepo(cwd);
  const recommendedNextAction = rewriteRecommendedNextAction(
    rawRecommendedNextAction,
    commandPrefix
  );
  const authorityStatus = rewriteAuthorityStatus(planAuthorityStatus({
    diagnostics: loaded.diagnostics,
    invalidClientConfigs: clientConfigs.some(
      (client) => client.status === "invalid"
    ),
    bypassFindings,
    riskFindings: importPlan.riskFindings,
    missingSecrets,
    switchboardConfigured: Object.keys(loaded.config.profiles).length > 0,
    switchboardInstalled: clientConfigs.some(
      (client) => client.status === "installed"
    ),
    recommendedNextAction: rawRecommendedNextAction
  }), commandPrefix);
  const status = doctorStatus({
    ok,
    nextSteps,
    authorityStatus
  });

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
    authorityStatus,
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
  if (options.bypassFindings.some((finding) => finding.status !== "accepted")) {
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
      kind:
        step.includes("pass create") || step.includes("mandate create")
          ? "mandate-create"
          : "info",
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
  authorityStatus?: AuthorityStatus;
  recommendedNextAction?: RecommendedNextAction;
  nextSteps: string[];
}): string {
  const lines = [`Switchboard doctor: ${formatDoctorStatus(result.status)}`];
  lines.push(formatDoctorReadinessLine(result.status));
  if (result.authorityStatus) {
    lines.push(
      `Authority status: ${formatAuthorityStatusLabel(result.authorityStatus)}`
    );
    lines.push(result.authorityStatus.summary);
    lines.push(formatAuthorityReadinessLine(result.authorityStatus.status));
  }

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

function formatRiskFindingLine(finding: RiskFinding): string {
  const provider =
    finding.provider === "unknown" ? "provider unknown" : finding.provider;
  const evidence =
    finding.evidence.length > 0 ? `; ${finding.evidence.join(", ")}` : "";
  return `  ${finding.severity} ${finding.kind} (${provider}${evidence}) - ${finding.reason}`;
}

function rewriteRiskFindingCommands(
  finding: RiskFinding,
  prefix: string
): RiskFinding {
  return {
    ...finding,
    nextActions: finding.nextActions.map((action) =>
      rewriteSwitchboardCommand(action, prefix)
    )
  };
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

function formatAuthorityReadinessLine(status: AuthorityStatus["status"]): string {
  if (status === "controlled") {
    return "Switchboard appears to be the active project MCP route; agents should use its scoped profiles, leases, approvals, and audit.";
  }
  if (status === "partial-control") {
    return "Switchboard is present, but missing tokens, client setup, or accepted risks still need attention before this repo is fully ready.";
  }
  if (status === "bypass-present") {
    return "Direct project MCP routes can still give agents tools outside Switchboard control; clean them up or explicitly accept the risk.";
  }
  return "Switchboard cannot make a trustworthy authority assessment until config or client parse errors are fixed.";
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

  const unaccepted = findings.filter((finding) => finding.status !== "accepted");
  const accepted = findings.length - unaccepted.length;
  const high = unaccepted.filter((finding) => finding.severity === "high").length;
  const base =
    unaccepted.length > 0
      ? `${unaccepted.length} unaccepted direct MCP bypass route(s) detected.`
      : "Only accepted direct MCP bypass route(s) remain.";
  const suffix = [
    ...(high > 0 ? [`${high} high-risk`] : []),
    ...(accepted > 0 ? [`${accepted} accepted-risk`] : [])
  ];
  return suffix.length > 0 ? `${base} (${suffix.join(", ")})` : base;
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
  if (presetId === "supabase-dev") {
    const profileName = `supabase_${repoName}_dev`;
    return {
      profileName,
      namespace: profileName,
      secretRef: `supabase/${repoName}/dev/access-token`
    };
  }

  const template = getProviderSafetyTemplate(presetId);
  return {
    profileName: template?.defaultProfileName ?? safeIdentifierForCommand(presetId),
    namespace: template?.defaultNamespace ?? safeIdentifierForCommand(presetId),
    secretRef: template?.defaultSecretRef ?? `${safeIdentifierForCommand(presetId)}/${repoName}/dev/token`
  };
}

function profileNameForProviderSecretRef(options: {
  cwd: string | undefined;
  provider: string;
  secretRef: string;
}): string | null {
  const loaded = loadSwitchboardConfig(optionsFromCwd(options.cwd));
  if (loadedConfigCommandError(loaded)) {
    return null;
  }

  for (const [profileName, profile] of Object.entries(loaded.config.profiles)) {
    if (profile.provider !== options.provider) {
      continue;
    }
    const upstreamEnv = profile.upstream?.env ?? {};
    for (const value of Object.values(upstreamEnv)) {
      if (
        isSecretRefRuntimeValue(value) &&
        value.secretRef === options.secretRef
      ) {
        return profileName;
      }
    }
  }

  return null;
}

function presetProfileDefaultForConfig(
  template: NonNullable<ReturnType<typeof getProviderSafetyTemplate>> | undefined,
  config: SwitchboardConfig
): string | undefined {
  if (!template) {
    return undefined;
  }
  const defaultWorkspaceProfiles = config.workspaces.default?.profiles ?? [];
  const defaultWorkspacePresetProfiles = defaultWorkspaceProfiles.filter((name) => {
    const profile = config.profiles[name];
    return profile?.provider === template.provider &&
      profileMatchesTemplatePreset(template.id, name, profile.namespace);
  });
  if (defaultWorkspacePresetProfiles.length === 1) {
    return defaultWorkspacePresetProfiles[0];
  }
  if (config.profiles[template.defaultProfileName]) {
    return template.defaultProfileName;
  }
  const presetProfiles = Object.entries(config.profiles)
    .filter(([name, profile]) =>
      profile.provider === template.provider &&
      profileMatchesTemplatePreset(template.id, name, profile.namespace)
    )
    .map(([name]) => name);
  if (presetProfiles.length === 1) {
    return presetProfiles[0];
  }
  const providerProfiles = Object.entries(config.profiles)
    .filter(([, profile]) => profile.provider === template.provider)
    .map(([name]) => name);
  return providerProfiles.length === 1
    ? providerProfiles[0]
    : template.defaultProfileName;
}

function profileMatchesTemplatePreset(
  presetId: string,
  profileName: string,
  namespace?: string
): boolean {
  const identifiers = [profileName, namespace ?? ""].map(safeIdentifierForCommand);
  if (presetId === "github-ci") {
    return identifiers.some((identifier) =>
      identifier === "github_ci" ||
      (identifier.startsWith("github_") && identifier.endsWith("_ci"))
    );
  }
  if (presetId === "vercel-preview") {
    return identifiers.some((identifier) =>
      identifier === "vercel_preview" ||
      (identifier.startsWith("vercel_") && identifier.endsWith("_preview"))
    );
  }
  if (presetId === "stripe-test") {
    return identifiers.some((identifier) =>
      identifier === "stripe_test" ||
      (identifier.startsWith("stripe_") && identifier.endsWith("_test"))
    );
  }
  if (presetId === "supabase-dev") {
    return identifiers.some((identifier) =>
      identifier === "supabase_dev" ||
      (identifier.startsWith("supabase_") && identifier.endsWith("_dev"))
    );
  }
  return identifiers.some((identifier) => identifier === safeIdentifierForCommand(presetId));
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
    ...(result.label === "Supabase Dev"
      ? [
          "",
          "Safety note: use a development project token only; for live dogfood, add upstream project scoping before creating passes."
        ]
      : []),
    "",
    "Next steps:",
    ...result.nextSteps.map((step) => `  ${formatHumanCommand(step)}`)
  ].join("\n");
}

function formatHumanCommand(command: string): string {
  const displayCommand = command.replace(
    /^(switchboard\s+secrets\s+set\s+\S+)\s+--value-stdin$/,
    "$1"
  );
  if (!isSourceCheckoutEntrypoint()) {
    return displayCommand;
  }

  if (displayCommand === "switchboard") {
    return "pnpm switchboard";
  }

  return displayCommand.startsWith("switchboard ")
    ? `pnpm switchboard ${displayCommand.slice("switchboard ".length)}`
    : displayCommand;
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
  const lines = [
    `one ${plan.rendered.template.provider} MCP profile: ${plan.rendered.profileName}`,
    `one local token alias for ${plan.rendered.template.secretEnvName}: ${plan.rendered.secretRef}`,
    `agent clients route through Switchboard after install`,
    `pass policy: ${policy.allowedTools?.length ?? 0} allow pattern(s), ${policy.approvalGates?.length ?? 0} approval gate(s), ${policy.deniedTools?.length ?? 0} deny pattern(s)`,
    `pass command binds authority to the current repo, branch, and ${plan.rendered.template.recommendedMandate.lease} lease`
  ];

  if (plan.id === "supabase-dev") {
    lines.push(
      "live dogfood still needs a development project token and upstream project scoping"
    );
  }

  return lines;
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
    "Recommended pass:",
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
    "Rendered pass policy:",
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
    `Requires pass policy: ${result.requiresMandatePolicy ? "yes" : "no"}`,
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
  backendReadWriteOk?: boolean;
  backendHelp?: SecretBackendErrorHelp;
  diagnostics: Array<{ level: string; message: string }>;
  usages: ReturnType<typeof collectSecretRefUsages>;
  missing: MissingSecretRef[];
}): string {
  const lines = [
    result.ok ? "Switchboard secrets doctor: OK" : "Switchboard secrets doctor: failed",
    `Index: ${result.indexPath}`
  ];

  if (result.backend) {
    const readWrite =
      result.backendReadWriteOk === false
        ? " — read/write check failed"
        : result.backendReadWriteOk === true
          ? " — read/write OK"
          : "";
    lines.push(`Backend: ${formatSecretBackendDiagnostic(result.backend)}${readWrite}`);
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.level}: ${diagnostic.message}`);
  }

  // A broken backend is the root cause — lead with it and its recovery path,
  // not with per-ref "set" commands that would crash the same way.
  if (result.backendHelp) {
    lines.push("", `Secret store problem: ${result.backendHelp.summary}`);
    if (result.backendHelp.detail) {
      lines.push(`  ${result.backendHelp.detail}`);
    }
    if (result.backendHelp.nextActions.length > 0) {
      lines.push("", "To fix:");
      for (const action of result.backendHelp.nextActions) {
        lines.push(`  ${action}`);
      }
    }
    if (result.usages.length > 0) {
      lines.push(
        "",
        `Waiting on the store above: ${result.usages.length} configured secretRef${result.usages.length === 1 ? "" : "s"}.`
      );
    }
    return lines.join("\n");
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

function secretBackendContextFromDiagnostic(
  diagnostic: Record<string, unknown>
): { backendId?: string; dataRoot?: string; configPath?: string } {
  const backend = diagnostic.backend;
  if (typeof backend !== "object" || backend === null) {
    return {};
  }
  const record = backend as Record<string, unknown>;
  return {
    ...(typeof record.id === "string" ? { backendId: record.id } : {}),
    ...(typeof record.dataRoot === "string" ? { dataRoot: record.dataRoot } : {}),
    ...(typeof record.configPath === "string"
      ? { configPath: record.configPath }
      : {})
  };
}

/**
 * Turns a raw secret-store failure into an actionable error envelope by asking
 * the backend to describe itself, so the message names the backend and offers a
 * recovery path instead of leaking a bare crypto exception.
 */
async function secretBackendErrorEnvelope(
  store: SecretStore,
  error: unknown,
  code: string
): Promise<{ code: string; message: string; nextActions: string[] }> {
  const diagnostic = await diagnoseSecretStore(store).catch(() => ({}));
  const help = describeSecretBackendError(error, {
    ...secretBackendContextFromDiagnostic(diagnostic)
  });
  return {
    code,
    message: help.detail ? `${help.summary} (${help.detail})` : help.summary,
    nextActions: help.nextActions
  };
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

function formatAuthorityMapDraft(draft: AuthorityMapDraft): string {
  const lines = [
    "Switchboard authority map draft",
    `Profile: ${draft.profileName}`,
    `Namespace: ${draft.namespace}`,
    `Discovered ${draft.counts.tools} tools`,
    `Allowed ${draft.counts.allowed}, approval-required ${draft.counts.approvalRequired}, denied ${draft.counts.denied}, review ${draft.counts.review}`,
    `Needs human review: ${draft.needsHumanReview ? "yes" : "no"}`
  ];

  const notableDenied = draft.groups.denied.slice(0, 5);
  const notableReview = draft.groups.review.slice(0, 5);
  if (notableDenied.length > 0) {
    lines.push("", "Denied examples:");
    for (const tool of notableDenied) {
      lines.push(`  ${tool.toolName} - ${tool.reason}`);
    }
  }
  if (notableReview.length > 0) {
    lines.push("", "Review examples:");
    for (const tool of notableReview) {
      lines.push(`  ${tool.toolName} - ${tool.reason}`);
    }
  }
  if (draft.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of draft.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  lines.push("", "Next:");
  for (const action of draft.nextActions) {
    lines.push(`  - ${action}`);
  }

  return lines.join("\n");
}

function formatAuthorityMapCheck(result: AuthorityMapCheckResult): string {
  const lines = [
    result.ok
      ? "Switchboard authority map check: valid"
      : "Switchboard authority map check: failed",
    `Profile: ${result.profileName}`,
    `Namespace: ${result.namespace}`,
    `Tools: ${result.counts.tools}`,
    `Allowed: ${result.counts.allowed}`,
    `Approval required: ${result.counts.approvalRequired}`,
    `Denied: ${result.counts.denied}`,
    `Review: ${result.counts.review}`,
    `Needs human review: ${result.needsHumanReview ? "yes" : "no"}`
  ];

  if (result.errors.length > 0) {
    lines.push("", "Errors:");
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  if (result.nextActions.length > 0) {
    lines.push("", "Next:");
    for (const action of result.nextActions) {
      lines.push(`  - ${action}`);
    }
  }

  return lines.join("\n");
}

interface AuthorityMapForMandate {
  sourcePath: string;
  profileName: string;
  namespace: string;
  draft: AuthorityMapDraft;
  check: AuthorityMapCheckResult;
  acceptedReview: boolean;
}

type AuthorityMapForMandateResult =
  | { ok: true; map: AuthorityMapForMandate }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        nextActions: string[];
      };
    };

function loadAuthorityMapForMandate(options: {
  file: string;
  cwd?: string;
  config: SwitchboardConfig;
  acceptReview?: boolean;
}): AuthorityMapForMandateResult {
  const sourcePath = isAbsolute(options.file)
    ? options.file
    : resolve(options.cwd ?? process.cwd(), options.file);
  try {
    const draft = parseAuthorityMapDraft(readFileSync(sourcePath, "utf8"));
    const check = checkAuthorityMapDraft(draft);
    if (!check.ok) {
      return {
        ok: false,
        error: {
          code: "authority_map_invalid",
          message: `authority map "${sourcePath}" is not valid for pass creation`,
          nextActions: [
            `Run switchboard authority check ${shellQuote(sourcePath)} --json and fix every error.`
          ]
        }
      };
    }
    if (check.needsHumanReview && !options.acceptReview) {
      return {
        ok: false,
        error: {
          code: "authority_map_needs_review",
          message:
            "authority map has warnings or review tools; acknowledge review before creating runtime authority",
          nextActions: [
            `Run switchboard authority check ${shellQuote(sourcePath)}.`,
            "Review denied/review tools and warnings.",
            `Re-run with --from-authority ${shellQuote(sourcePath)} --accept-review after review.`
          ]
        }
      };
    }

    const profile = options.config.profiles[draft.profileName];
    if (!profile) {
      return {
        ok: false,
        error: {
          code: "authority_map_profile_not_found",
          message: `authority map profile "${draft.profileName}" is not configured in this repo`,
          nextActions: [
            "Run switchboard scan to inspect configured profiles.",
            "Run switchboard setup <preset> or switchboard import --dry-run to add the profile."
          ]
        }
      };
    }
    const configuredNamespace = profile.namespace ?? draft.profileName;
    if (configuredNamespace !== draft.namespace) {
      return {
        ok: false,
        error: {
          code: "authority_map_namespace_mismatch",
          message: `authority map namespace "${draft.namespace}" does not match configured profile namespace "${configuredNamespace}"`,
          nextActions: [
            `Run switchboard authority draft --profile ${draft.profileName} --json to regenerate the map from current config.`
          ]
        }
      };
    }

    return {
      ok: true,
      map: {
        sourcePath,
        profileName: draft.profileName,
        namespace: draft.namespace,
        draft,
        check,
        acceptedReview: Boolean(options.acceptReview)
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "authority_map_load_failed",
        message: messageFromError(error),
        nextActions: [
          "Run switchboard authority draft --profile <name> --json to generate a schema-valid authority map."
        ]
      }
    };
  }
}

function authorityMapMandateMetadata(map: AuthorityMapForMandate): {
  schemaVersion: AuthorityMapDraft["schemaVersion"];
  sourcePath: string;
  profileName: string;
  namespace: string;
  counts: AuthorityMapDraft["counts"];
  needsHumanReview: boolean;
  acceptedReview: boolean;
  warnings: string[];
} {
  return {
    schemaVersion: map.draft.schemaVersion,
    sourcePath: map.sourcePath,
    profileName: map.profileName,
    namespace: map.namespace,
    counts: map.check.counts,
    needsHumanReview: map.check.needsHumanReview,
    acceptedReview: map.acceptedReview,
    warnings: map.check.warnings
  };
}

function formatMandateCreatedFromAuthority(
  base: string,
  authorityMap?: AuthorityMapForMandate
): string {
  if (!authorityMap) {
    return base;
  }
  return [
    base,
    "",
    "Authority map:",
    `  Source: ${authorityMap.sourcePath}`,
    `  Profile: ${authorityMap.profileName}`,
    `  Tools: allowed ${authorityMap.check.counts.allowed}, approval-required ${authorityMap.check.counts.approvalRequired}, denied ${authorityMap.check.counts.denied}, review ${authorityMap.check.counts.review}`,
    `  Human review acknowledged: ${authorityMap.acceptedReview ? "yes" : "not required"}`,
    "  Review tools stay denied by the suggested pass policy."
  ].join("\n");
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
    `Pass: ${
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
      `  ${commandPrefix} pass handoff ${result.mandate.id} --state completed --summary <summary>`
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
    "pass",
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
    "Switchboard pass demo",
    `Repo: ${options.cwd}`,
    `Profile: ${options.profileName}`,
    `Namespace: ${options.namespace}`,
    `Task: ${options.task}`,
    `Pass id: ${options.mandateId}`,
    "",
    "Installed CLI commands:",
    `  ${commandPrefix} ${createArgs.join(" ")}`,
    `  ${commandPrefix} tools --mandate ${options.mandateId}`,
    `  ${commandPrefix} tools --mandate ${options.mandateId} --json`,
    `  ${commandPrefix} mcp --mandate ${options.mandateId}`,
    `  ${commandPrefix} approvals --mandate ${options.mandateId}`,
    `  ${commandPrefix} logs --mandate ${options.mandateId}`,
    `  ${commandPrefix} pass handoff ${options.mandateId} --state completed --summary ${shellQuote("Demo finished")} --by human-demo`,
    `  ${commandPrefix} pass report ${options.mandateId} --json`,
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

function grantSecretRefs(
  config: SwitchboardConfig,
  profiles: string[]
): string[] {
  const included = new Set(profiles);
  const refs = collectSecretRefUsages(config)
    .filter((usage) => included.has(usage.profileName))
    .map((usage) => usage.ref);
  return [...new Set(refs)];
}

function formatGrantBadge(
  mandate: MandateWithStatus,
  options: { secretRefs: string[]; paint?: Paint }
): string {
  const paint = options.paint ?? makePaint(false);
  const repoName = basename(mandate.repoPath);
  const reach =
    mandate.allowedTools.length > 0 ? mandate.allowedTools : ["everything"];
  const body: string[] = [
    "",
    `  ${paint.bold(`${repoName} · ${mandate.branch}`)}`,
    `  acting as ${mandate.agentRole}`,
    "",
    "  can reach"
  ];
  for (const tool of reach) {
    body.push(`    ${paint.green("→")} ${tool}`);
  }
  body.push(`  ${paint.bold("everything else denied")}`, "");
  if (options.secretRefs.length > 0) {
    body.push(
      `  secrets  ${options.secretRefs.map((ref) => `🔒 ${ref}`).join("   ")}`,
      `  ${paint.dim("held in your keychain · never printed, never committed")}`,
      ""
    );
  }
  body.push(
    `  ${paint.yellow(`expires in ${mandate.lease}`)}   ${paint.dim(`(${mandate.expiresAt})`)}`,
    `  ${paint.dim("ends on its own · revoke early with: switchboard revoke")}`,
    `  ${paint.dim(`pass id ${mandate.id}`)}`,
    ""
  );

  // Left-railed card so emoji display width can't break a right border.
  // Frame widths are measured on plain text, then painted, so ANSI codes
  // can never skew the rule length.
  const title = "SWITCHBOARD · PASS GRANTED";
  const rule = `╭─ ${title} ${"─".repeat(Math.max(4, 48 - title.length))}`;
  const topRule = paint.green(
    `╭─ ${paint.bold(title)} ${"─".repeat(Math.max(4, 48 - title.length))}`
  );
  const lines = [
    topRule,
    ...body.map((line) => `${paint.green("│")}${line}`),
    paint.green(`╰${"─".repeat(rule.length - 1)}`)
  ];
  return lines.join("\n");
}

function formatMandateCreated(path: string, mandate: MandateWithStatus): string {
  const commandPrefix = `switchboard --cwd ${shellQuote(mandate.repoPath)}`;
  return [
    `Created pass ${mandate.id}`,
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
    `Created by: ${mandate.createdBy ?? "unrecorded"}`,
    `Authority source: ${formatAuthoritySource(mandate.authoritySource)}`,
    `Policy hash: ${mandate.policyHash ?? "unrecorded"}`,
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
    `  ${commandPrefix} pass handoff ${mandate.id} --state completed --summary <summary>`
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
      })),
      policyHash: mandate.policyHash ?? null
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
      createdBy: mandate.createdBy ?? null,
      source: mandate.authoritySource ?? null,
      policyHash: mandate.policyHash ?? null,
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
      status: mandate.runtimeStatus,
      events: mandate.leaseEvents ?? []
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
    evidence: chain.map((mandate) => mandateReportEvidence(mandate)),
    childrenByParent: childrenByParent(chain),
    mandates: chain,
    approvalRequests,
    auditEntries: limitedAuditEntries
  };
}

function mandateReportEvidence(
  mandate: MandateWithStatus
): MandateReportEvidence {
  return {
    id: mandate.id,
    mandateUid: mandate.mandateUid ?? null,
    createdBy: mandate.createdBy ?? null,
    authoritySource: mandate.authoritySource ?? null,
    policyHash: mandate.policyHash ?? null,
    leaseEvents: mandate.leaseEvents ?? []
  };
}

function formatAuthoritySource(
  source: MandateAuthoritySource | undefined
): string {
  if (!source) {
    return "unrecorded";
  }

  return source.ref ? `${source.type} (${source.ref})` : source.type;
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
      approvalGateId: request.approvalGateId,
      ...(request.approvalGateReason
        ? { approvalGateReason: request.approvalGateReason }
        : {}),
      ...(request.approvalGateRisk
        ? { approvalGateRisk: request.approvalGateRisk }
        : {}),
      ...(request.approvalGateLabels && request.approvalGateLabels.length > 0
        ? { approvalGateLabels: request.approvalGateLabels }
        : {}),
      expiresAt: request.expiresAt
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
      ? [`selected pass is already ${options.selected.handoffState}`]
      : []),
    ...openChildMandates.map(
      (mandate) => `child pass "${mandate.id}" remains open`
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
        `switchboard pass handoff ${mandate.id} --state completed --summary <summary>`
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
      ...(request.approvalGateReason
        ? { approvalGateReason: request.approvalGateReason }
        : {}),
      ...(request.approvalGateRisk
        ? { approvalGateRisk: request.approvalGateRisk }
        : {}),
      ...(request.approvalGateLabels && request.approvalGateLabels.length > 0
        ? { approvalGateLabels: request.approvalGateLabels }
        : {}),
      expiresAt: request.expiresAt,
      title: `Approval request ${request.id} needs a decision`,
      detail: approvalEscalationDetail(request),
      commands: approvalEscalationCommands(request),
      nextActions: approvalEscalationNextActions(request)
    }));
  const openChildItems: MandateEscalationItem[] =
    report.readiness.openChildMandates.map((mandate) => ({
      type: "open_child_mandate",
      priority: "handoff",
      mandateId: mandate.id,
      mandateUid: mandate.mandateUid,
      title: `Child pass ${mandate.id} remains open`,
      detail: `Worker role ${mandate.agentRole} on branch ${mandate.branch} must hand off before the selected pass can close.`,
      commands: [
        `switchboard pass report ${mandate.id} --json`,
        `switchboard pass handoff ${mandate.id} --state completed --summary <summary>`
      ]
    }));
  const missingSecretItems: MandateEscalationItem[] =
    report.readiness.missingSecretRefs.map((missing) => ({
      type: "missing_secret_ref",
      priority: "setup",
      mandateId: report.selectedMandateId,
      mandateUid: report.selectedMandateUid,
      title: `Secret ref ${missing.ref} is ${missing.status}`,
      detail: `Profiles ${missing.profiles.join(", ")} need ${missing.envNames.join(", ")} before this pass can run.`,
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
      title: `Pass ${handoff.id} is ${handoff.state}`,
      detail:
        handoff.summary ??
        `Pass ${handoff.id} handed off with state ${handoff.state}.`,
      commands: [`switchboard pass report ${handoff.id} --json`]
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

function approvalEscalationDetail(
  request: MandateReportReadiness["pendingApprovalRequests"][number]
): string {
  const parts = [
    `Tool ${request.toolName} is waiting on approval gate ${request.approvalGateId}`,
    ...(request.approvalGateRisk ? [`risk:${request.approvalGateRisk}`] : []),
    ...(request.approvalGateLabels && request.approvalGateLabels.length > 0
      ? [`labels:${request.approvalGateLabels.join(",")}`]
      : []),
    ...(request.approvalGateReason ? [`reason:${request.approvalGateReason}`] : []),
    `expires:${request.expiresAt}`
  ];
  return `${parts.join(" ")}.`;
}

function approvalEscalationCommands(
  request: MandateReportReadiness["pendingApprovalRequests"][number]
): string[] {
  return [
    `switchboard approvals --mandate ${request.mandateId} --json`,
    `switchboard approve ${request.id}`,
    `switchboard deny ${request.id}`
  ];
}

function approvalEscalationNextActions(
  request: MandateReportReadiness["pendingApprovalRequests"][number]
): string[] {
  return [
    `decide whether ${request.toolName} is safe for pass ${request.mandateId}`,
    `use --reason when approving or denying to preserve decision context`,
    `retry the original ${request.toolName} tool call after approval`
  ];
}

function formatMandateEscalationCopyText(
  report: MandateReportPayload,
  items: MandateEscalationItem[]
): string {
  if (items.length === 0) {
    return `Switchboard pass ${report.selectedMandateId} has no local escalation items.`;
  }

  return [
    `Switchboard escalation for pass ${report.selectedMandateId}: ${items.length} item(s) need attention.`,
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

async function createApprovalRequestsPayload(
  options: ApprovalRequestsPayloadOptions
): Promise<ApprovalRequestsPayload> {
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

async function watchApprovalRequests(options: {
  payloadOptions: ApprovalRequestsPayloadOptions;
  intervalMs: number;
  timeoutMs: number | null;
  json: boolean;
  writeOut: (message: string) => void;
}): Promise<void> {
  const startedAt = Date.now();
  const snapshots: ApprovalWatchPayload["snapshots"] = [];
  let iteration = 0;

  while (true) {
    const approvals = await createApprovalRequestsPayload(options.payloadOptions);
    const observedAt = new Date().toISOString();
    if (options.json) {
      snapshots.push({ observedAt, approvals });
    }

    if (!options.json) {
      const heading =
        options.timeoutMs === 0
          ? "Approval requests snapshot"
          : iteration === 0
          ? `Watching approvals every ${formatDurationMs(options.intervalMs)}${
              options.timeoutMs === null
                ? ". Press Ctrl+C to stop."
                : ` for ${formatDurationMs(options.timeoutMs)}.`
            }`
          : `Approval requests updated at ${observedAt}`;
      options.writeOut(`${heading}\n\n${formatApprovalRequests(approvals)}`);
    }

    iteration += 1;
    if (options.timeoutMs !== null && Date.now() - startedAt >= options.timeoutMs) {
      break;
    }

    const remainingMs =
      options.timeoutMs === null
        ? options.intervalMs
        : Math.max(0, options.timeoutMs - (Date.now() - startedAt));
    if (remainingMs === 0) {
      break;
    }
    await sleep(Math.min(options.intervalMs, remainingMs));
  }

  if (options.json) {
    const payload: ApprovalWatchPayload = {
      schemaVersion: approvalWatchSchemaVersion,
      generatedAt: new Date().toISOString(),
      watch: {
        intervalMs: options.intervalMs,
        timeoutMs: options.timeoutMs,
        snapshots: snapshots.length
      },
      snapshots
    };
    options.writeOut(JSON.stringify(payload, null, 2));
  }
}

function formatMandateStatus(result: {
  path: string;
  repoPath: string | null;
  mandates: MandateWithStatus[];
  readiness?: MandateStatusReadiness;
}, options: { verbose?: boolean } = {}): string {
  const lines = [
    "Switchboard passes",
    `Store: ${result.path}`,
    `Repo: ${result.repoPath ?? "all"}`
  ];

  if (result.mandates.length === 0) {
    lines.push("", "No passes found.");
    return lines.join("\n");
  }

  lines.push("");
  for (const mandate of result.mandates) {
    if (options.verbose) {
      lines.push(formatMandateStatusVerboseLine(mandate));
      continue;
    }
    lines.push(...formatMandateStatusSummaryLines(mandate));
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

function formatMandateStatusSummaryLines(
  mandate: MandateWithStatus
): string[] {
  const approvalCount = mandate.approvalGates.length;
  const allowSummary =
    mandate.allowedTools.length > 0
      ? `${mandate.allowedTools.length} allowed`
      : "all tools allowed";
  const denySummary = `${mandate.deniedTools.length} denied`;
  const approvalSummary = `${approvalCount} approval-required`;
  return [
    `Pass: ${mandate.id}`,
    `  Lease: ${mandate.runtimeStatus}; expires ${mandate.expiresAt}`,
    `  Repo: ${mandate.repoPath}`,
    `  Branch: ${mandate.branch}`,
    `  Agent: ${mandate.agentRole}`,
    `  Profiles: ${mandate.profiles.join(", ") || "none"}`,
    `  Policy: ${allowSummary}, ${denySummary}, ${approvalSummary}`,
    `  Handoff: ${mandate.handoffState}`,
    `  MCP: switchboard mcp --mandate ${mandate.id}`,
    `  Run: switchboard run --mandate ${mandate.id} -- <command>`,
    `  Approvals: switchboard approvals --mandate ${mandate.id}`,
    `  Report: switchboard pass report ${mandate.id}`
  ];
}

function formatMandateStatusVerboseLine(mandate: MandateWithStatus): string {
  return [
    `Pass: ${mandate.id}`,
    `  Runtime: ${mandate.runtimeStatus}`,
    `  Task: ${mandate.task}`,
    `  Agent: ${mandate.agentRole}`,
    `  Repo: ${mandate.repoPath}`,
    `  Worktree: ${mandate.worktreePath}`,
    `  Branch: ${mandate.branch}`,
    ...(mandate.parentMandateId
      ? [
          `  Parent: ${mandate.parentMandateId}`,
          `  Delegated by: ${mandate.delegatedBy ?? "unknown"}`,
          `  Delegation path: ${mandate.delegationPath?.join(" > ") ?? mandate.id}`
        ]
      : []),
    `  Profiles: ${mandate.profiles.join(", ") || "none"}`,
    "  Policy:",
    `    Allowed: ${mandate.allowedTools.length > 0 ? mandate.allowedTools.join(", ") : "all"}`,
    `    Denied: ${mandate.deniedTools.length > 0 ? mandate.deniedTools.join(", ") : "none"}`,
    ...formatApprovalGateDetailLines(mandate.approvalGates, "    "),
    `  Created by: ${mandate.createdBy ?? "unrecorded"}`,
    `  Authority source: ${formatAuthoritySource(mandate.authoritySource)}`,
    `  Policy hash: ${mandate.policyHash ?? "unrecorded"}`,
    ...(mandate.leaseEvents ?? []).map((event) => {
      const actor = event.actor ? ` actor:${event.actor}` : "";
      return `  Lease ${event.type} at:${event.at} lease:${event.lease} expires:${event.expiresAt}${actor}`;
    }),
    `  Handoff: ${mandate.handoffState}`,
    `  Expires: ${mandate.expiresAt}`,
    "  Commands:",
    `    switchboard mcp --mandate ${mandate.id}`,
    `    switchboard run --mandate ${mandate.id} -- <command>`,
    `    switchboard approvals --mandate ${mandate.id}`,
    `    switchboard pass report ${mandate.id}`
  ].join("\n");
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
      blockers.push(`pass "${mandate.id}" is expired`);
      nextActions.push(`switchboard pass renew ${mandate.id} --lease ${mandate.lease}`);
    }
    if (mandate.runtimeStatus === "closed") {
      warnings.push(
        `pass "${mandate.id}" is closed with handoff state "${mandate.handoffState}"`
      );
    }
    if (gitBinding && mandate.branch !== gitBinding.branch) {
      blockers.push(
        `pass "${mandate.id}" is scoped to branch "${mandate.branch}", but current git branch is "${gitBinding.branch}"`
      );
      nextActions.push(`git switch ${mandate.branch}`);
    }
    if (gitBinding && mandate.worktreePath !== gitBinding.worktreePath) {
      blockers.push(
        `pass "${mandate.id}" is scoped to worktree "${mandate.worktreePath}", but current worktree is "${gitBinding.worktreePath}"`
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
    `Updated pass ${mandate.id}`,
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
    "Switchboard pass report",
    `Store: ${report.path}`,
    `Audit log: ${report.auditLogPath}`,
    `Repo: ${report.repoPath ?? "all"}`,
    `Root: ${report.rootMandateId}`,
    `Selected: ${report.selectedMandateId}`,
    `Passes: ${report.counts.mandates} open:${report.counts.open} completed:${report.counts.completed} blocked:${report.counts.blocked} cancelled:${report.counts.cancelled}`,
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

  if (report.approvalRequests.length > 0) {
    lines.push("", "Approval request details:");
    for (const request of report.approvalRequests) {
      lines.push(...formatApprovalRequestDetailLines(request, "  "));
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
    lines.push("", "Pass chain:");
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

  if (report.evidence.length > 0) {
    lines.push("", "Authority evidence:");
    for (const evidence of report.evidence) {
      lines.push(
        `  ${evidence.id} createdBy:${evidence.createdBy ?? "unrecorded"} source:${formatAuthoritySource(evidence.authoritySource ?? undefined)}`
      );
      lines.push(`    Policy hash: ${evidence.policyHash ?? "unrecorded"}`);
      for (const event of evidence.leaseEvents) {
        const actor = event.actor ? ` actor:${event.actor}` : "";
        lines.push(
          `    Lease ${event.type} at:${event.at} lease:${event.lease} expires:${event.expiresAt}${actor}`
        );
      }
    }
  }

  if (report.auditEntries.length > 0) {
    lines.push("", "Recent audit entries:");
    for (const entry of report.auditEntries) {
      lines.push(
        `  ${entry.timestamp} ${entry.status} pass:${entry.mandateId ?? "none"} ${entry.action}${entry.toolName ? ` ${entry.toolName}` : ""}`
      );
    }
  }

  return lines.join("\n");
}

function formatMandateEscalation(escalation: MandateEscalationPayload): string {
  const lines = [
    "Switchboard pass escalation",
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
    if (item.approvalRequestId) {
      lines.push(`    approval: ${item.approvalRequestId}`);
    }
    if (item.approvalGateRisk) {
      lines.push(`    risk: ${item.approvalGateRisk}`);
    }
    if (item.approvalGateLabels && item.approvalGateLabels.length > 0) {
      lines.push(`    labels: ${item.approvalGateLabels.join(", ")}`);
    }
    if (item.approvalGateReason) {
      lines.push(`    reason: ${item.approvalGateReason}`);
    }
    if (item.expiresAt) {
      lines.push(`    expires: ${item.expiresAt}`);
    }
    if (item.nextSteps && item.nextSteps.length > 0) {
      lines.push(`    Next: ${item.nextSteps.join("; ")}`);
    }
    if (item.nextActions && item.nextActions.length > 0) {
      lines.push(`    Actions: ${item.nextActions.join("; ")}`);
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

function formatApprovalGateDetailLines(
  gates: MandateWithStatus["approvalGates"],
  indent: string
): string[] {
  if (gates.length === 0) {
    return [`${indent}Approval gates: none`];
  }

  const lines = [`${indent}Approval gates:`];
  for (const gate of gates) {
    lines.push(`${indent}  - ${gate.toolPattern}`);
    lines.push(`${indent}    gate: ${gate.id}`);
    if (gate.risk) {
      lines.push(`${indent}    risk: ${gate.risk}`);
    }
    if (gate.labels && gate.labels.length > 0) {
      lines.push(`${indent}    labels: ${gate.labels.join(", ")}`);
    }
    if (gate.reason) {
      lines.push(`${indent}    reason: ${gate.reason}`);
    }
  }
  return lines;
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
      `Scope: pass ${result.mandateId}${
        result.includeChildren ? " + children" : ""
      }`
    );
  }

  if (result.counts) {
    lines.push(
      `Summary: ${result.counts.pending} pending, ${result.counts.approved} approved, ${result.counts.denied} denied, ${result.counts.expired} expired, ${result.counts.stale} stale`
    );
    if (result.counts.pending > 0) {
      lines.push("Operator: review pending requests, approve only intentional side effects, then retry approved tool calls.");
    }
  }

  if (result.requests.length === 0) {
    lines.push("", "No approval requests found.");
    return lines.join("\n");
  }

  lines.push("");
  for (const request of result.requests) {
    lines.push(...formatApprovalRequestDetailLines(request, ""));
    lines.push("");
  }

  return lines.join("\n");
}

function formatApprovalRequestDetailLines(
  request: ApprovalRequestWithStatus,
  indent: string
): string[] {
  const lines = [`${indent}${request.id} [${request.runtimeStatus}] ${request.toolName}`];
  lines.push(`${indent}  pass: ${request.mandateId}`);
  if (request.parentMandateId) {
    lines.push(`${indent}  parent: ${request.parentMandateId}`);
  }
  if (request.delegatedBy) {
    lines.push(`${indent}  delegated by: ${request.delegatedBy}`);
  }
  if (request.delegationPath) {
    lines.push(`${indent}  delegation path: ${request.delegationPath.join(" > ")}`);
  }
  lines.push(`${indent}  branch: ${request.branch}`);
  lines.push(`${indent}  tool: ${request.toolName}`);
  lines.push(
    `${indent}  gate: ${request.approvalGateId} (${request.approvalGatePattern})`
  );
  if (request.approvalGateRisk) {
    lines.push(`${indent}  risk: ${request.approvalGateRisk}`);
  }
  if (request.approvalGateLabels && request.approvalGateLabels.length > 0) {
    lines.push(`${indent}  labels: ${request.approvalGateLabels.join(", ")}`);
  }
  if (request.approvalGateReason) {
    lines.push(`${indent}  reason: ${request.approvalGateReason}`);
  }
  lines.push(`${indent}  expires: ${request.expiresAt}`);
  const nextActions = approvalRequestNextActions(request);
  if (nextActions.length > 0) {
    lines.push(`${indent}  next:`);
    for (const action of nextActions) {
      lines.push(`${indent}    ${action}`);
    }
  }
  return lines;
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
    `Pass: ${request.mandateId}`,
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
      labelParts.push(`pass:${entry.mandateId}`);
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

function validateProviderSecretValue(
  presetId: string,
  value: string
):
  | { ok: true }
  | { ok: false; code: string; message: string; nextActions: string[] } {
  const trimmed = value.trim();

  if (presetId === "stripe-test") {
    if (
      /^(sk|rk)_live_/i.test(trimmed) ||
      /(^|[_\-.])live([_\-.]|$)/i.test(trimmed)
    ) {
      return {
        ok: false,
        code: "live_stripe_key_rejected",
        message:
          "stripe-test only accepts Stripe test-mode credentials; this value looks live or production-scoped.",
        nextActions: [
          "Use a restricted Stripe test key such as rk_test_... or sk_test_....",
          "Run switchboard setup stripe-test again with a test-mode key."
        ]
      };
    }
  }

  if (presetId === "supabase-dev") {
    if (
      /service[_\-.]?role/i.test(trimmed) ||
      /(^|[_\-.])(?:prod|production|live|admin|root)(?:[_\-.]|$)/i.test(
        trimmed
      )
    ) {
      return {
        ok: false,
        code: "unsafe_supabase_dev_credential_rejected",
        message:
          "supabase-dev only accepts development Supabase credentials; this value looks production, admin, root, live, or service-role scoped.",
        nextActions: [
          "Use a development-project Supabase access token with the narrowest available scope.",
          "For live dogfood, add project scoping to the upstream command before creating passes."
        ]
      };
    }
  }

  return { ok: true };
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

  if (command !== "mandate" && command !== "pass") {
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
    message: mandateMessageInPassVocabulary(message),
    nextActions: mandateRecoveryNextActions(message)
  };
}

// Core error messages still say "mandate" (packages/core is unchanged);
// rewrite the outgoing human prose to the "pass" vocabulary. This is a
// word-boundary replace, so a quoted task or id that itself contains the
// word "mandate" would also be rewritten — an accepted tradeoff.
function mandateMessageInPassVocabulary(message: string): string {
  return message.replace(/\bmandate\b/g, "pass");
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
      `switchboard pass renew ${expired[1]} --lease 2h`,
      `switchboard pass create ${expired[1]} --lease 2h --agent <role> --profiles <profiles> --branch <branch>`
    ];
  }

  const missing = /^mandate "([^"]+)" was not found/.exec(message);
  if (missing?.[1]) {
    return ["Run switchboard pass status to list passes for this repo."];
  }

  const branchMismatch =
    /^mandate "([^"]+)" is scoped to branch "([^"]+)", but current git branch is "([^"]+)"/.exec(
      message
    );
  if (branchMismatch?.[2]) {
    return [
      `git switch ${branchMismatch[2]}`,
      `switchboard pass status ${branchMismatch[1] ?? ""}`.trim()
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

    options.writeErr(
      `error: ${mandateMessageInPassVocabulary(messageFromError(error))}`
    );
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

function parseWatchDurationForCommand(
  value: string | undefined,
  optionName: "--interval" | "--timeout",
  constraints: {
    defaultMs?: number;
    minMs: number;
    maxMs: number;
    allowZero: boolean;
  }
):
  | { ok: true; value: number | null }
  | { ok: false; message: string; nextActions: string[] } {
  if (value === undefined) {
    return { ok: true, value: constraints.defaultMs ?? null };
  }

  const trimmed = value.trim();
  if (trimmed === "0") {
    if (constraints.allowZero) {
      return { ok: true, value: 0 };
    }
    return {
      ok: false,
      message: `${optionName} must be at least ${formatDurationMs(constraints.minMs)}`,
      nextActions: [`Pass ${optionName} ${formatDurationMs(constraints.minMs)} or longer.`]
    };
  }

  const match = /^([1-9]\d*)(s|m)$/.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      message: `${optionName} must use 0 or a duration like 2s or 1m`,
      nextActions: [`Pass ${optionName} 2s, ${optionName} 1m, or ${optionName} 0 when allowed.`]
    };
  }

  const amountText = match[1];
  const unit = match[2];
  if (!amountText || !unit) {
    return {
      ok: false,
      message: `${optionName} must use 0 or a duration like 2s or 1m`,
      nextActions: [`Pass ${optionName} 2s, ${optionName} 1m, or ${optionName} 0 when allowed.`]
    };
  }

  const durationMs = Number(amountText) * (unit === "s" ? 1_000 : 60_000);
  if (durationMs < constraints.minMs) {
    return {
      ok: false,
      message: `${optionName} must be at least ${formatDurationMs(constraints.minMs)}`,
      nextActions: [`Pass ${optionName} ${formatDurationMs(constraints.minMs)} or longer.`]
    };
  }
  if (durationMs > constraints.maxMs) {
    return {
      ok: false,
      message: `${optionName} must be ${formatDurationMs(constraints.maxMs)} or less`,
      nextActions: [`Pass ${optionName} ${formatDurationMs(constraints.maxMs)} or shorter.`]
    };
  }

  return { ok: true, value: durationMs };
}

function formatDurationMs(value: number): string {
  if (value === 0) {
    return "0";
  }
  if (value % 60_000 === 0) {
    return `${value / 60_000}m`;
  }
  if (value % 1_000 === 0) {
    return `${value / 1_000}s`;
  }
  return `${value}ms`;
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

  if (options.bypassFindings.some((finding) => finding.status !== "accepted")) {
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
          : profile.provider === "supabase"
            ? getProviderSafetyTemplate("supabase-dev")
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
      steps.push("switchboard pass create --from github-ci");
    }

    if (profile.provider === "vercel") {
      steps.push(
        `switchboard presets check vercel-preview --profile ${profileName}`
      );
      steps.push("switchboard pass create --from vercel-preview");
    }

    if (profile.provider === "stripe") {
      steps.push(`switchboard presets check stripe-test --profile ${profileName}`);
      steps.push("switchboard pass create --from stripe-test");
    }

    if (profile.provider === "supabase") {
      steps.push(`switchboard presets check supabase-dev --profile ${profileName}`);
      steps.push("switchboard pass create --from supabase-dev");
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
      message: `pass "${options.mandate.id}" is scoped to ${options.mandate.repoPath}, not ${options.cwd}`,
      nextActions: [`cd ${shellQuoteCommandArg(options.mandate.repoPath)}`],
      envKeys: []
    };
  }

  if (cwdPath !== worktreePath) {
    return {
      ok: false,
      code: "worktree_mismatch",
      message: `pass "${options.mandate.id}" is scoped to worktree ${options.mandate.worktreePath}`,
      nextActions: [`cd ${shellQuoteCommandArg(options.mandate.worktreePath)}`],
      envKeys: []
    };
  }

  const branch = currentGitBranch(options.cwd);
  if (branch && branch !== options.mandate.branch) {
    return {
      ok: false,
      code: "branch_mismatch",
      message: `pass "${options.mandate.id}" is scoped to branch ${options.mandate.branch}, but current branch is ${branch}`,
      nextActions: [`git switch ${shellQuoteCommandArg(options.mandate.branch)}`],
      envKeys: []
    };
  }

  if (options.mandate.handoffState !== "open") {
    return {
      ok: false,
      code: "handoff_closed",
      message: `pass "${options.mandate.id}" is closed with handoff state "${options.mandate.handoffState}"`,
      nextActions: [`switchboard pass status ${options.mandate.id}`],
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
      message: `pass profiles were not found: ${missingProfiles.join(", ")}`,
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
        `Use gh, vercel, stripe, or a fixture CLI directly, or create a pass with --allow-tool run:${commandClass.name}.`
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
    return [`switchboard pass renew ${mandateId} --lease 2h`];
  }
  if (message.includes("closed")) {
    return [`switchboard pass status ${mandateId}`];
  }
  if (message.includes("was not found")) {
    return ["switchboard pass status"];
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
  authorityStatus?: AuthorityStatus;
}): "ok" | "setup-incomplete" | "failed" {
  if (!options.ok) {
    return "failed";
  }

  if (
    options.authorityStatus &&
    options.authorityStatus.status !== "controlled"
  ) {
    return "setup-incomplete";
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
    subcommand.startsWith("mandate create ") ||
    subcommand.startsWith("pass create ")
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

  const localBinary = localPackageBinaryEntrypoint();
  if (localBinary) {
    return {
      command: localBinary,
      commandArgs: []
    };
  }

  return {
    command: "switchboard",
    commandArgs: []
  };
}

function localPackageBinaryEntrypoint(): string | null {
  const entrypoint = process.argv[1];
  if (
    !entrypoint ||
    !isAbsolute(entrypoint) ||
    basename(entrypoint) !== "switchboard" ||
    !entrypoint.includes(`${sep}.bin${sep}`)
  ) {
    return null;
  }

  return entrypoint;
}

function sourceCheckoutEntrypoint(): string | null {
  const sourceRoot = sourceCheckoutRoot();
  if (!sourceRoot) {
    return null;
  }

  return resolve(sourceRoot, "apps", "cli", "dist", "index.js");
}

function sourceCheckoutRoot(): string | null {
  const entrypoint = process.argv[1];
  if (!entrypoint || !entrypoint.endsWith(`${sep}apps${sep}cli${sep}dist${sep}index.js`)) {
    return null;
  }
  if (
    (process.env.npm_lifecycle_event === "switchboard" &&
      process.env.npm_package_name === "switchboard") ||
    isAbsolute(entrypoint)
  ) {
    return resolve(
      entrypoint.slice(
        0,
        -`${sep}apps${sep}cli${sep}dist${sep}index.js`.length
      )
    );
  }

  return null;
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

function toolSurfaceFailureNextActions(
  message: string,
  mandateId: string | undefined
): string[] {
  const ref = /secretRef "([^"]+)"/.exec(message)?.[1];
  if (ref) {
    return [`switchboard secrets set ${ref} --value-stdin`];
  }
  if (mandateId) {
    return [
      `switchboard pass status ${mandateId}`,
      `switchboard pass report ${mandateId}`
    ];
  }
  return [
    "switchboard pass status",
    "switchboard pass create --from <preset>"
  ];
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
    timeoutMs?: number;
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
    return await router.discoverTools(
      options.timeoutMs ? { timeout: options.timeoutMs } : undefined
    );
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
