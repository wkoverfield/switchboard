import {
  evaluateMandateToolPolicy,
  noopAuditLogger,
  safeAuditLog,
  type AuditLogger,
  type MandateToolPolicy
} from "@switchboard-mcp/core";
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
  toolPolicy?: MandateToolPolicy;
}

export class GenericMcpRouter {
  private readonly connections = new Map<string, StdioUpstreamConnection>();
  private routes = new Map<string, ToolRoute>();
  private readonly auditLogger: AuditLogger;
  private readonly mandateId: string | undefined;
  private readonly toolPolicy: MandateToolPolicy;

  constructor(
    private readonly profiles: StdioUpstreamProfile[],
    options: GenericMcpRouterOptions = {}
  ) {
    this.auditLogger = options.auditLogger ?? noopAuditLogger;
    this.mandateId = options.mandateId;
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

  async discoverTools(): Promise<NamespacedTool[]> {
    const tools: NamespacedTool[] = [];
    const routes = new Map<string, ToolRoute>();

    for (const profile of this.profiles) {
      const connection = this.connectionForProfile(profile.profileName);
      const upstreamTools = await connection.listTools();

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
        if (policyDecision.allowed) {
          tools.push(toNamespacedTool(profile.profileName, profile.namespace, tool));
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
      ...(namespace ? { namespace } : {}),
      ...(this.mandateId ? { mandateId: this.mandateId } : {})
    };
  }
}
