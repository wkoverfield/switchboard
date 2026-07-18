import {
  createApprovalRequest,
  evaluateMandateToolPolicy,
  evaluateSeatbeltMcp,
  findApprovedApprovalRequest,
  noopAuditLogger,
  safeAuditLog,
  seatbeltApprovalWindowMs,
  seatbeltDenialMessage,
  type AuditLogger,
  type MandateApprovalGate,
  type MandateToolPolicy,
  type SeatbeltPolicy
} from "@switchboard-mcp/core";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  namespacedToolName,
  toNamespacedTool,
  type NamespacedTool,
  type ToolRoute
} from "./namespaced-tools.js";
import {
  StdioUpstreamConnection,
  type StdioUpstreamProfile,
  type UpstreamToolResult
} from "./stdio-upstream.js";

// The ambient seatbelt floor: a catastrophe denylist evaluated on every
// routed call, with no pass bound (approvals keyed under the synthetic
// "seatbelt" mandate id) and as an un-removable layer under an active pass
// (approvals keyed under that pass). A trip denies immediately, queues an
// approval request, and an approved request lets a retry of the same
// pattern and tool through until the approval expires.
export interface SeatbeltRouterOptions {
  policy: SeatbeltPolicy;
  approvals: {
    mandateId: string;
    mandateUid?: string;
    repoPath: string;
    branch: string;
    /** Approval expiry; defaults to now + seatbeltApprovalWindowMs. */
    expiresAt?: string;
    storePath?: string;
  };
}

export interface GenericMcpRouterOptions {
  auditLogger?: AuditLogger;
  mandateId?: string;
  auditContext?: {
    mandateUid?: string;
    repoPath?: string;
    worktreePath?: string;
    branch?: string;
  };
  toolPolicy?: MandateToolPolicy;
  seatbelt?: SeatbeltRouterOptions;
  // Strict-mode short circuit: when set, no upstream is discovered or called.
  // tools/list is empty and every call is rejected with `reason`. Used when
  // enforcement is strict and no pass is bound, so "no pass" means "nothing
  // moves" instead of serving configured profiles ungoverned.
  denyAll?: { reason: string };
}

export class GenericMcpRouter {
  private readonly connections = new Map<string, StdioUpstreamConnection>();
  private routes = new Map<string, ToolRoute>();
  private readonly auditLogger: AuditLogger;
  private readonly mandateId: string | undefined;
  private readonly auditContext: GenericMcpRouterOptions["auditContext"];
  private readonly toolPolicy: MandateToolPolicy;
  private readonly seatbelt: SeatbeltRouterOptions | undefined;
  private readonly denyAll: { reason: string } | undefined;

  constructor(
    private readonly profiles: StdioUpstreamProfile[],
    options: GenericMcpRouterOptions = {}
  ) {
    this.auditLogger = options.auditLogger ?? noopAuditLogger;
    this.mandateId = options.mandateId;
    this.auditContext = options.auditContext;
    this.toolPolicy = options.toolPolicy ?? {};
    this.seatbelt = options.seatbelt;
    this.denyAll = options.denyAll;

    for (const profile of profiles) {
      if (this.connections.has(profile.profileName)) {
        throw new Error(`Duplicate upstream profile: ${profile.profileName}`);
      }

      this.connections.set(
        profile.profileName,
        new StdioUpstreamConnection(profile)
      );
    }
  }

  async discoverTools(options?: RequestOptions): Promise<NamespacedTool[]> {
    // Strict mode with no pass bound: expose nothing and never touch an
    // upstream. An empty tools/list is the honest surface for "no authority".
    if (this.denyAll) {
      this.routes = new Map();
      return [];
    }

    const tools: NamespacedTool[] = [];
    const routes = new Map<string, ToolRoute>();

    for (const profile of this.profiles) {
      const connection = this.connectionForProfile(profile.profileName);
      const upstreamTools = options
        ? await connection.listToolsWithOptions(options)
        : await connection.listTools();

      for (const tool of upstreamTools) {
        const namespacedName = namespacedToolName(profile.namespace, tool.name);
        if (routes.has(namespacedName)) {
          throw new Error(`Duplicate namespaced tool: ${namespacedName}`);
        }

        routes.set(namespacedName, {
          namespacedName,
          profileName: profile.profileName,
          upstreamName: tool.name
        });
        const policyDecision = evaluateMandateToolPolicy(
          namespacedName,
          this.toolPolicy
        );
        if (policyDecision.allowed || "approvalRequired" in policyDecision) {
          const namespacedTool = toNamespacedTool(
            profile.profileName,
            profile.namespace,
            tool
          );
          if ("approvalRequired" in policyDecision) {
            namespacedTool._meta = withApprovalRequiredMetadata(
              namespacedTool._meta,
              policyDecision.approvalGate
            );
          }
          tools.push(namespacedTool);
        }
      }
    }

    this.routes = routes;
    return tools;
  }

  async callTool(
    namespacedName: string,
    args?: Record<string, unknown>
  ): Promise<UpstreamToolResult> {
    // Strict mode with no pass bound: reject every call with a clear reason,
    // and record the denial so the audit log shows what was refused.
    if (this.denyAll) {
      await safeAuditLog(
        this.auditLogger,
        this.auditEntry(
          {
            action: "tool_call",
            status: "error",
            toolName: namespacedName,
            error: this.denyAll.reason
          },
          undefined
        )
      );
      throw new Error(this.denyAll.reason);
    }

    const route = this.routes.get(namespacedName);
    if (!route) {
      throw new Error(
        `Unknown namespaced tool "${namespacedName}". Run discoverTools() first.`
      );
    }

    const connection = this.connectionForProfile(route.profileName);
    const profile = this.profiles.find(
      (item) => item.profileName === route.profileName
    );
    const startedAt = Date.now();
    // Ambient seatbelt floor: evaluated before any pass policy so a pass can
    // never allow its way past it; an approved request lets the retry through.
    await this.enforceSeatbelt(route, args, profile?.namespace, startedAt);
    const policyDecision = evaluateMandateToolPolicy(
      route.namespacedName,
      this.toolPolicy
    );
    if (!policyDecision.allowed) {
      const entry = this.auditEntry(
        {
          action: "tool_call",
          status: "error",
          profileName: route.profileName,
          toolName: route.namespacedName,
          upstreamName: route.upstreamName,
          ...("approvalRequired" in policyDecision
            ? {
                approvalGateId: policyDecision.approvalGate.id,
                approvalGatePattern: policyDecision.approvalGate.toolPattern
              }
            : {}),
          durationMs: Date.now() - startedAt,
          error: policyDecision.reason
        },
        profile?.namespace
      );
      await safeAuditLog(this.auditLogger, entry);
      throw new Error(policyDecision.reason);
    }

    try {
      const result = await connection.callTool(route.upstreamName, args);
      await safeAuditLog(
        this.auditLogger,
        this.auditEntry(
          {
            action: "tool_call",
            status: "ok",
            profileName: route.profileName,
            toolName: route.namespacedName,
            upstreamName: route.upstreamName,
            ...(policyDecision.approvalRequestId
              ? { approvalRequestId: policyDecision.approvalRequestId }
              : {}),
            durationMs: Date.now() - startedAt
          },
          profile?.namespace
        )
      );
      return result;
    } catch (error) {
      await safeAuditLog(
        this.auditLogger,
        this.auditEntry(
          {
            action: "tool_call",
            status: "error",
            profileName: route.profileName,
            toolName: route.namespacedName,
            upstreamName: route.upstreamName,
            ...(policyDecision.approvalRequestId
              ? { approvalRequestId: policyDecision.approvalRequestId }
              : {}),
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error)
          },
          profile?.namespace
        )
      );
      throw error;
    }
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map((connection) => connection.close())
    );
  }

  private async enforceSeatbelt(
    route: ToolRoute,
    args: Record<string, unknown> | undefined,
    namespace: string | undefined,
    startedAt: number
  ): Promise<void> {
    if (!this.seatbelt) {
      return;
    }

    const trip = evaluateSeatbeltMcp(
      route.namespacedName,
      args,
      this.seatbelt.policy
    );
    if (!trip) {
      return;
    }

    const context = this.seatbelt.approvals;
    const storePath = context.storePath
      ? { path: context.storePath }
      : {};
    const approved = await findApprovedApprovalRequest({
      mandateId: context.mandateId,
      ...(context.mandateUid ? { mandateUid: context.mandateUid } : {}),
      repoPath: context.repoPath,
      toolName: route.namespacedName,
      approvalGateId: trip.gateId,
      ...storePath
    });
    if (approved) {
      return;
    }

    const request = await createApprovalRequest({
      mandateId: context.mandateId,
      ...(context.mandateUid ? { mandateUid: context.mandateUid } : {}),
      repoPath: context.repoPath,
      branch: context.branch,
      toolName: route.namespacedName,
      approvalGateId: trip.gateId,
      approvalGatePattern: trip.pattern.pattern,
      approvalGateReason: trip.pattern.reason,
      approvalGateRisk: "critical",
      approvalGateLabels: ["seatbelt"],
      expiresAt:
        context.expiresAt ??
        new Date(Date.now() + seatbeltApprovalWindowMs).toISOString(),
      ...storePath
    });
    const message = seatbeltDenialMessage({
      pattern: trip.pattern,
      approvalRequestId: request.id
    });
    await safeAuditLog(
      this.auditLogger,
      this.auditEntry(
        {
          action: "tool_call",
          status: "error",
          profileName: route.profileName,
          toolName: route.namespacedName,
          upstreamName: route.upstreamName,
          mandateId: context.mandateId,
          repoPath: context.repoPath,
          branch: context.branch,
          approvalRequestId: request.id,
          approvalGateId: trip.gateId,
          approvalGatePattern: trip.pattern.pattern,
          durationMs: Date.now() - startedAt,
          error: message
        },
        namespace
      )
    );
    throw new Error(message);
  }

  private connectionForProfile(profileName: string): StdioUpstreamConnection {
    const connection = this.connections.get(profileName);
    if (!connection) {
      throw new Error(`Unknown upstream profile: ${profileName}`);
    }

    return connection;
  }

  private auditEntry(
    entry: Parameters<AuditLogger["log"]>[0],
    namespace: string | undefined
  ): Parameters<AuditLogger["log"]>[0] {
    return {
      ...entry,
      ...(this.auditContext?.mandateUid
        ? { mandateUid: this.auditContext.mandateUid }
        : {}),
      ...(this.auditContext?.repoPath
        ? { repoPath: this.auditContext.repoPath }
        : {}),
      ...(this.auditContext?.worktreePath
        ? { worktreePath: this.auditContext.worktreePath }
        : {}),
      ...(this.auditContext?.branch ? { branch: this.auditContext.branch } : {}),
      ...(namespace ? { namespace } : {}),
      ...(this.mandateId ? { mandateId: this.mandateId } : {})
    };
  }
}

function withApprovalRequiredMetadata(
  meta: Record<string, unknown> | undefined,
  approvalGate: MandateApprovalGate
): Record<string, unknown> {
  const switchboardMeta = isRecord(meta?.switchboard)
    ? meta.switchboard
    : {};

  return {
    ...meta,
    switchboard: {
      ...switchboardMeta,
      approvalRequired: {
        gateId: approvalGate.id,
        toolPattern: approvalGate.toolPattern,
        ...(approvalGate.reason ? { reason: approvalGate.reason } : {}),
        ...(approvalGate.risk ? { risk: approvalGate.risk } : {}),
        ...(approvalGate.labels && approvalGate.labels.length > 0
          ? { labels: approvalGate.labels }
          : {})
      }
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
