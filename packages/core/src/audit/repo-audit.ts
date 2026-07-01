import type { AuthorityControlStatus } from "../authority/authority-status.js";
import type { RecommendedNextAction } from "../next-actions/next-actions.js";
import type { SwitchboardScanResult } from "../scan/scan.js";

export const repoAuditSchemaVersion = "switchboard.repo-audit.v1";

export type RepoAuditStatus = "ready" | "needs-attention" | "unsafe" | "invalid";
export type RepoAuditCheckStatus = "pass" | "warn" | "fail";

export interface RepoAuditCheck {
  id: string;
  title: string;
  status: RepoAuditCheckStatus;
  summary: string;
  evidence: string[];
  nextActions: string[];
}

export interface RepoAuditFindingSummary {
  bypasses: number;
  risks: number;
  warnings: number;
  directClientServers: number;
  switchboardProfiles: number;
  critical: number;
  high: number;
  medium: number;
  info: number;
}

export interface RepoAuditResult {
  schemaVersion: typeof repoAuditSchemaVersion;
  status: RepoAuditStatus;
  summary: string;
  repo: SwitchboardScanResult["repo"];
  authorityStatus: SwitchboardScanResult["authorityStatus"];
  findingSummary: RepoAuditFindingSummary;
  checks: RepoAuditCheck[];
  recommendedNextAction: RecommendedNextAction;
  nextActions: string[];
}

export function createRepoAudit(scan: SwitchboardScanResult): RepoAuditResult {
  const checks = [
    authorityCheck(scan),
    bypassCheck(scan),
    secretAndProviderCheck(scan),
    unknownMcpCommandCheck(scan),
    clientScopeConflictCheck(scan),
    configuredSurfaceBloatCheck(scan),
    clientInstallCheck(scan),
    mandateReadinessCheck(scan)
  ];
  const status = auditStatus(scan.authorityStatus.status, checks);
  return {
    schemaVersion: repoAuditSchemaVersion,
    status,
    summary: auditSummary(status),
    repo: scan.repo,
    authorityStatus: scan.authorityStatus,
    findingSummary: findingSummary(scan),
    checks,
    recommendedNextAction: scan.recommendedNextAction,
    nextActions: [
      ...new Set([
        ...(scan.recommendedNextAction.primary
          ? [scan.recommendedNextAction.primary.command]
          : []),
        ...scan.nextActions,
        ...checks.flatMap((check) => check.nextActions)
      ])
    ]
  };
}

function unknownMcpCommandCheck(scan: SwitchboardScanResult): RepoAuditCheck {
  const unknown = scan.bypassFindings.filter(
    (finding) => finding.command && !isKnownMcpLaunchCommand(finding.command)
  );
  return {
    id: "unknown-mcp-commands",
    title: "Unknown MCP commands",
    status: unknown.length > 0 ? "warn" : "pass",
    summary:
      unknown.length > 0
        ? `${unknown.length} direct MCP server(s) use commands Switchboard does not recognize yet.`
        : "No unknown direct MCP launch commands detected.",
    evidence: unknown
      .slice(0, 6)
      .map((finding) => `${finding.client}:${finding.serverName} ${finding.command}`),
    nextActions: unknown.length > 0 ? ["switchboard import --dry-run"] : []
  };
}

function clientScopeConflictCheck(scan: SwitchboardScanResult): RepoAuditCheck {
  const withDirectServers = scan.clients.filter(
    (client) => client.otherServerNames.length > 0
  );
  const staleOrMissingWithDirect = withDirectServers.filter(
    (client) => client.status !== "installed"
  );
  return {
    id: "client-scope-conflicts",
    title: "Client scope conflicts",
    status:
      staleOrMissingWithDirect.length > 0
        ? "fail"
        : withDirectServers.length > 0
          ? "warn"
          : "pass",
    summary:
      staleOrMissingWithDirect.length > 0
        ? "Project client config has direct MCP servers while Switchboard is missing or stale."
        : withDirectServers.length > 0
          ? "Project client config has direct MCP servers alongside Switchboard; keep intentional routes visible as accepted risk."
          : "No project client scope conflicts detected. Global/user client config is not audited in this V1 check.",
    evidence: withDirectServers.flatMap((client) =>
      client.otherServerNames.map(
        (server) => `${client.client}:${server} project-direct`
      )
    ),
    nextActions:
      staleOrMissingWithDirect.length > 0
        ? ["switchboard import --dry-run", "switchboard import --write --cleanup-client"]
        : withDirectServers.length > 0
          ? ["switchboard import --dry-run"]
          : []
  };
}

function configuredSurfaceBloatCheck(scan: SwitchboardScanResult): RepoAuditCheck {
  const directServerCount = scan.clients.reduce(
    (sum, client) => sum + client.otherServerNames.length,
    0
  );
  const profileCount = scan.switchboard.profileNames.length;
  const totalConfiguredSurface = directServerCount + profileCount;
  const status =
    totalConfiguredSurface >= 12 || directServerCount >= 6
      ? "warn"
      : "pass";
  return {
    id: "configured-surface-bloat",
    title: "Configured tool surface bloat",
    status,
    summary:
      status === "warn"
        ? `${totalConfiguredSurface} configured profile/direct MCP surface(s) may expose too much tool context by default.`
        : "Configured profile/direct MCP surface count is modest.",
    evidence: [
      `switchboard profiles: ${profileCount}`,
      `direct client MCP servers: ${directServerCount}`
    ],
    nextActions:
      status === "warn"
        ? [
            "Use switchboard mandate create --from <preset> before launching agents.",
            "Use switchboard authority draft --profile <name> --json to narrow unknown tool surfaces."
          ]
        : []
  };
}

function authorityCheck(scan: SwitchboardScanResult): RepoAuditCheck {
  const status =
    scan.authorityStatus.status === "controlled"
      ? "pass"
      : scan.authorityStatus.status === "invalid" ||
          scan.authorityStatus.status === "bypass-present"
        ? "fail"
        : "warn";
  return {
    id: "authority-status",
    title: "Authority status",
    status,
    summary: scan.authorityStatus.summary,
    evidence: [
      `status: ${scan.authorityStatus.status}`,
      ...scan.authorityStatus.findings.slice(0, 6)
    ],
    nextActions: commandShapeAction(scan.authorityStatus.recommendedAction)
  };
}

function bypassCheck(scan: SwitchboardScanResult): RepoAuditCheck {
  const unaccepted = scan.bypassFindings.filter(
    (finding) => finding.status !== "accepted"
  );
  const accepted = scan.bypassFindings.length - unaccepted.length;
  return {
    id: "direct-mcp-bypasses",
    title: "Direct MCP bypasses",
    status: unaccepted.length > 0 ? "fail" : accepted > 0 ? "warn" : "pass",
    summary:
      unaccepted.length > 0
        ? `${unaccepted.length} direct MCP route(s) can bypass Switchboard.`
        : accepted > 0
          ? `${accepted} direct MCP route(s) are accepted risk and remain visible.`
          : "No direct MCP bypasses detected in supported project clients.",
    evidence: scan.bypassFindings
      .slice(0, 6)
      .map(
        (finding) =>
          `${finding.client}:${finding.serverName} ${finding.severity} ${finding.status}`
      ),
    nextActions:
      unaccepted.length > 0 ? ["switchboard import --write --cleanup-client"] : []
  };
}

function secretAndProviderCheck(scan: SwitchboardScanResult): RepoAuditCheck {
  const riskyProviders = scan.providers.filter(
    (provider) =>
      provider.environment === "prod" ||
      provider.envVars.some((name) =>
        /(SECRET|TOKEN|KEY|PASSWORD|PRIVATE|SERVICE_ROLE|ADMIN|ROOT)/i.test(name)
      )
  );
  const highRisks = scan.riskFindings.filter(
    (finding) => finding.severity === "critical" || finding.severity === "high"
  );
  return {
    id: "provider-secret-hints",
    title: "Provider and secret hints",
    status:
      highRisks.length > 0
        ? "fail"
        : riskyProviders.length > 0 || scan.riskFindings.length > 0
          ? "warn"
          : "pass",
    summary:
      riskyProviders.length > 0 || scan.riskFindings.length > 0
        ? "Provider/env hints need review before agents receive tool access."
        : "No production or secret-looking provider hints detected.",
    evidence: [
      ...riskyProviders.map((provider) => {
        const env =
          provider.environment === "unknown" ? "" : ` ${provider.environment}`;
        const vars =
          provider.envVars.length > 0 ? ` ${provider.envVars.join(",")}` : "";
        return `${provider.provider}${env}${vars}`;
      }),
      ...scan.riskFindings
        .slice(0, 6)
        .map((finding) => `${finding.severity}:${finding.kind}`)
    ].slice(0, 8),
    nextActions:
      riskyProviders.length > 0 || scan.riskFindings.length > 0
        ? ["switchboard import --dry-run", "switchboard doctor"]
        : []
  };
}

function clientInstallCheck(scan: SwitchboardScanResult): RepoAuditCheck {
  const missingOrInvalid = scan.clients.filter(
    (client) => client.status !== "installed"
  );
  return {
    id: "client-routing",
    title: "Client routing",
    status: missingOrInvalid.length > 0 ? "warn" : "pass",
    summary:
      missingOrInvalid.length > 0
        ? `${missingOrInvalid.length} supported project client(s) do not route through Switchboard.`
        : "Supported project clients route through Switchboard.",
    evidence: scan.clients.map(
      (client) => `${client.client}: ${client.status} (${client.message})`
    ),
    nextActions: missingOrInvalid.map(
      (client) => `switchboard install ${client.client} --write`
    )
  };
}

function mandateReadinessCheck(scan: SwitchboardScanResult): RepoAuditCheck {
  const hasProfiles = scan.switchboard.profileNames.length > 0;
  const hasMandateSuggestion = scan.suggestions.some(
    (suggestion) => suggestion.kind === "mandate"
  );
  return {
    id: "mandate-readiness",
    title: "Mandate readiness",
    status: hasMandateSuggestion ? "pass" : hasProfiles ? "warn" : "warn",
    summary: hasMandateSuggestion
      ? "A preset-backed mandate can be created from the configured profiles."
      : hasProfiles
        ? "Profiles exist, but no preset-backed mandate suggestion was detected."
        : "No Switchboard profiles are configured yet.",
    evidence: [
      ...scan.switchboard.profileNames.map((profile) => `profile: ${profile}`),
      ...scan.suggestions
        .filter((suggestion) => suggestion.kind === "mandate")
        .map((suggestion) => `mandate: ${suggestion.command}`)
    ],
    nextActions: hasMandateSuggestion
      ? scan.suggestions
          .filter((suggestion) => suggestion.kind === "mandate")
          .map((suggestion) => suggestion.command)
      : scan.suggestions
          .filter((suggestion) => suggestion.kind === "provider-profile")
          .map((suggestion) => suggestion.command)
  };
}

function findingSummary(scan: SwitchboardScanResult): RepoAuditFindingSummary {
  const severities = [...scan.bypassFindings, ...scan.riskFindings].map(
    (finding) => finding.severity
  );
  return {
    bypasses: scan.bypassFindings.length,
    risks: scan.riskFindings.length,
    warnings: scan.warnings.length,
    directClientServers: scan.clients.reduce(
      (sum, client) => sum + client.otherServerNames.length,
      0
    ),
    switchboardProfiles: scan.switchboard.profileNames.length,
    critical: severities.filter((severity) => severity === "critical").length,
    high: severities.filter((severity) => severity === "high").length,
    medium: severities.filter((severity) => severity === "medium").length,
    info: severities.filter((severity) => severity === "info").length
  };
}

function isKnownMcpLaunchCommand(command: string): boolean {
  const base = command.split(/[\\/]/).pop() ?? command;
  return new Set([
    "docker",
    "node",
    "npx",
    "npm",
    "pnpm",
    "python",
    "python3",
    "uvx",
    "switchboard"
  ]).has(base);
}

function auditStatus(
  authorityStatus: AuthorityControlStatus,
  checks: RepoAuditCheck[]
): RepoAuditStatus {
  if (authorityStatus === "invalid") {
    return "invalid";
  }
  if (checks.some((check) => check.status === "fail")) {
    return "unsafe";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "needs-attention";
  }
  return "ready";
}

function auditSummary(status: RepoAuditStatus): string {
  switch (status) {
    case "ready":
      return "Detected agent tool access is routed through Switchboard with no blocking findings.";
    case "needs-attention":
      return "Switchboard can assess this repo, but setup or accepted risk still needs attention.";
    case "unsafe":
      return "Direct or high-risk agent tool access should be fixed before giving agents this repo.";
    case "invalid":
      return "Switchboard cannot audit this repo until config parsing errors are fixed.";
  }
}

function commandShapeAction(
  command: { command: string; args: string[] } | null
): string[] {
  return command ? [[command.command, ...command.args].join(" ")] : [];
}
