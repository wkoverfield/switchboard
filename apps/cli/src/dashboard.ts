import { createServer, type Server } from "node:http";
import { isIP } from "node:net";
import { basename } from "node:path";
import {
  listApprovalRequests,
  listMandates,
  readAuditLogEntries,
  resolveApprovalRequestStorePath,
  resolveAuditLogPath,
  resolveMandateStorePath,
  type AuditLogEntry
} from "@switchboard-mcp/core";
import { dashboardHtml } from "./dashboard-page.js";

export const dashboardStateSchemaVersion = "switchboard.dashboard-state.v2";

export interface DashboardOptions {
  port?: number;
  host?: string;
  enforcement?: "default" | "strict";
  enforcementRepoPath?: string;
  auditLogPath?: string;
  mandateStorePath?: string;
  approvalStorePath?: string;
  auditLimit?: number;
}

export interface DashboardHandle {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

interface DashboardPass {
  id: string;
  branch: string;
  repoPath: string;
  repoName: string;
  agentRole: string;
  profiles: string[];
  runtimeStatus: string;
  createdAt: string;
  leaseStartedAt: string;
  expiresAt: string;
  lease: string;
  allowedTools: string[];
  deniedTools: string[];
  approvalGateCount: number;
  approvalGates: Array<{
    id: string;
    toolPattern: string;
    reason?: string | undefined;
    risk?: string | undefined;
  }>;
}

type DashboardAuditOutcome =
  | "allowed"
  | "gated"
  | "denied"
  | "cancelled"
  | "error";

interface DashboardAuditEntry extends AuditLogEntry {
  dashboardOutcome: DashboardAuditOutcome;
}

type DashboardSourceHealth = "ok" | "error";
type DashboardMode = "live" | "idle" | "degraded";

interface DashboardState {
  ok: true;
  schemaVersion: typeof dashboardStateSchemaVersion;
  generatedAt: string;
  repoEnforcement: "default" | "strict";
  enforcementRepoPath: string | null;
  enforcementRepoName: string | null;
  mode: DashboardMode;
  sourceHealth: {
    mandates: DashboardSourceHealth;
    approvals: DashboardSourceHealth;
    audit: DashboardSourceHealth;
  };
  passes: DashboardPass[];
  pendingApprovals: Array<{
    id: string;
    toolName: string;
    mandateId: string;
    repoPath: string;
    createdAt: string;
    approvalGateId: string;
    approvalGatePattern: string;
  }>;
  audit: DashboardAuditEntry[];
  counts: {
    activePasses: number;
    pendingApprovals: number;
    allowedCalls: number;
    gatedCalls: number;
    deniedCalls: number;
    errorCalls: number;
  };
}

export async function collectDashboardState(
  options: DashboardOptions = {}
): Promise<DashboardState> {
  const auditLogPath = options.auditLogPath ?? resolveAuditLogPath();
  const mandateStorePath = options.mandateStorePath ?? resolveMandateStorePath();
  const approvalStorePath =
    options.approvalStorePath ?? resolveApprovalRequestStorePath();
  const auditLimit = options.auditLimit ?? 200;
  const repoEnforcement = options.enforcement ?? "default";
  const enforcementRepoPath = options.enforcementRepoPath ?? null;

  const [mandatesResult, approvalsResult, auditResult] =
    await Promise.allSettled([
      listMandates({ path: mandateStorePath }),
      listApprovalRequests({ path: approvalStorePath }),
      readAuditLogEntries({ path: auditLogPath, limit: auditLimit })
    ]);
  const mandates =
    mandatesResult.status === "fulfilled" ? mandatesResult.value : [];
  const approvals =
    approvalsResult.status === "fulfilled" ? approvalsResult.value : [];
  const audit = auditResult.status === "fulfilled" ? auditResult.value : [];
  const sourceHealth = {
    mandates: mandatesResult.status === "fulfilled" ? "ok" : "error",
    approvals: approvalsResult.status === "fulfilled" ? "ok" : "error",
    audit: auditResult.status === "fulfilled" ? "ok" : "error"
  } as const;

  const passes: DashboardPass[] = mandates
    .filter((mandate) => mandate.runtimeStatus === "active")
    .map((mandate) => {
      const latestLeaseEvent = mandate.leaseEvents?.at(-1);
      return {
        id: mandate.id,
        branch: mandate.branch,
        repoPath: mandate.repoPath,
        repoName: basename(mandate.repoPath),
        agentRole: mandate.agentRole,
        profiles: mandate.profiles,
        runtimeStatus: mandate.runtimeStatus,
        createdAt: mandate.createdAt,
        leaseStartedAt: latestLeaseEvent?.at ?? mandate.createdAt,
        expiresAt: mandate.expiresAt,
        lease: mandate.lease,
        allowedTools: mandate.allowedTools,
        deniedTools: mandate.deniedTools,
        approvalGateCount: mandate.approvalGates?.length ?? 0,
        approvalGates: (mandate.approvalGates ?? []).map((gate) => ({
          id: gate.id,
          toolPattern: gate.toolPattern,
          ...(gate.reason ? { reason: gate.reason } : {}),
          ...(gate.risk ? { risk: gate.risk } : {})
        }))
      };
    });

  const pendingApprovals = approvals
    .filter((request) => request.runtimeStatus === "pending")
    .map((request) => ({
      id: request.id,
      toolName: request.toolName,
      mandateId: request.mandateId,
      repoPath: request.repoPath,
      createdAt: request.createdAt,
      approvalGateId: request.approvalGateId,
      approvalGatePattern: request.approvalGatePattern
    }));

  const dashboardAudit = [...audit].reverse().map((entry) => ({
    ...entry,
    dashboardOutcome: dashboardAuditOutcome(entry)
  }));
  const toolCalls = dashboardAudit.filter(
    (entry) => entry.action === "tool_call"
  );
  const degraded = Object.values(sourceHealth).some(
    (status) => status === "error"
  );
  const mode: DashboardMode = degraded
    ? "degraded"
    : passes.length > 0
      ? "live"
      : "idle";

  return {
    ok: true,
    schemaVersion: dashboardStateSchemaVersion,
    generatedAt: new Date().toISOString(),
    repoEnforcement,
    enforcementRepoPath,
    enforcementRepoName: enforcementRepoPath
      ? basename(enforcementRepoPath)
      : null,
    mode,
    sourceHealth,
    passes,
    pendingApprovals,
    audit: dashboardAudit,
    counts: {
      activePasses: passes.length,
      pendingApprovals: pendingApprovals.length,
      allowedCalls: toolCalls.filter(
        (entry) => entry.dashboardOutcome === "allowed"
      ).length,
      gatedCalls: toolCalls.filter(
        (entry) => entry.dashboardOutcome === "gated"
      ).length,
      deniedCalls: toolCalls.filter(
        (entry) => entry.dashboardOutcome === "denied"
      ).length,
      errorCalls: toolCalls.filter(
        (entry) => entry.dashboardOutcome === "error"
      ).length
    }
  };
}

export async function startDashboard(
  options: DashboardOptions = {}
): Promise<DashboardHandle> {
  // Local-only by design: the dashboard is a read-only window over local
  // state files and must never listen on a routable interface.
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 7878;

  if (!isLoopbackHost(host)) {
    throw new Error(
      `dashboard host must be loopback-only (received ${JSON.stringify(host)})`
    );
  }

  const server = createServer((request, response) => {
    if (!isLoopbackRequestHost(request.headers.host)) {
      response.writeHead(403, {
        ...dashboardSecurityHeaders,
        "content-type": "text/plain; charset=utf-8"
      });
      response.end("forbidden");
      return;
    }

    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host}`
    );

    if (url.pathname === "/api/state") {
      void collectDashboardState(options)
        .then((state) => {
          response.writeHead(200, {
            ...dashboardSecurityHeaders,
            "content-type": "application/json",
            "cache-control": "no-store"
          });
          response.end(JSON.stringify(state));
        })
        .catch((error: unknown) => {
          response.writeHead(500, {
            ...dashboardSecurityHeaders,
            "content-type": "application/json"
          });
          response.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "unknown error"
            })
          );
        });
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(200, {
        ...dashboardSecurityHeaders,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(dashboardHtml());
      return;
    }

    response.writeHead(404, {
      ...dashboardSecurityHeaders,
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("not found");
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(requestedPort, host, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : requestedPort;

  return {
    server,
    port,
    url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      })
  };
}

const dashboardSecurityHeaders = {
  "content-security-policy":
    "default-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
} as const;

function dashboardAuditOutcome(entry: AuditLogEntry): DashboardAuditOutcome {
  if (
    entry.approvalDecision === "denied" ||
    entry.approvalDecision === "declined"
  ) {
    return "denied";
  }
  if (entry.approvalDecision === "cancelled") {
    return "cancelled";
  }
  if (entry.approvalDecision === "failed") {
    return "error";
  }
  if (entry.status === "ok") {
    return "allowed";
  }

  const reason = String(entry.error ?? "").toLowerCase();
  if (
    /approval request .* (?:was |is )?denied/.test(reason)
  ) {
    return "denied";
  }
  if (entry.approvalGateId) {
    return "gated";
  }
  if (
    reason.includes("denied by pass policy") ||
    reason.includes("denied by mandate policy") ||
    /^tool .+ is denied (?:for|by) /.test(reason) ||
    reason.includes("not allowed by pass policy") ||
    reason.includes("not allowed by mandate policy") ||
    reason.includes("no active pass") ||
    reason.includes("out of scope") ||
    reason.includes("branch mismatch") ||
    reason.includes(" is expired")
  ) {
    return "denied";
  }
  return "error";
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  const ipVersion = isIP(normalized);
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    (ipVersion === 4 && normalized.startsWith("127."))
  );
}

function isLoopbackRequestHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname;
    const unwrapped =
      hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;
    return isLoopbackHost(unwrapped);
  } catch {
    return false;
  }
}
