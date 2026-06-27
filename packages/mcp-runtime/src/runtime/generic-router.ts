import {
  evaluateMandateToolPolicy,
  noopAuditLogger,
  safeAuditLog,
  type AuditLogger,
  type MandateApprovalGate,
  type MandateToolPolicy
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
}

export class GenericMcpRouter {
  private readonly connections = new Map<string, StdioUpstreamConnection>();
  private routes = new Map<string, ToolRoute>();
  private readonly auditLogger: AuditLogger;
  private readonly mandateId: string | undefined;
  private readonly auditContext: GenericMcpRouterOptions["auditContext"];
  private readonly toolPolicy: MandateToolPolicy;

  constructor(
    private readonly profiles: StdioUpstreamProfile[],
    options: GenericMcpRouterOptions = {}
  ) {
    this.auditLogger = options.auditLogger ?? noopAuditLogger;
    this.mandateId = options.mandateId;
    this.auditContext = options.auditContext;
    this.toolPolicy = options.toolPolicy ?? {};

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
