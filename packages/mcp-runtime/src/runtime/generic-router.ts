import {
  noopAuditLogger,
  safeAuditLog,
  type AuditLogger
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
}

export class GenericMcpRouter {
  private readonly connections = new Map<string, StdioUpstreamConnection>();
  private routes = new Map<string, ToolRoute>();
  private readonly auditLogger: AuditLogger;

  constructor(
    private readonly profiles: StdioUpstreamProfile[],
    options: GenericMcpRouterOptions = {}
  ) {
    this.auditLogger = options.auditLogger ?? noopAuditLogger;

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
        tools.push(toNamespacedTool(profile.profileName, profile.namespace, tool));
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

    try {
      const result = await connection.callTool(route.upstreamName, args);
      const entry = {
        action: "tool_call",
        status: "ok",
        profileName: route.profileName,
        toolName: route.namespacedName,
        upstreamName: route.upstreamName,
        durationMs: Date.now() - startedAt
      } as const;
      await safeAuditLog(
        this.auditLogger,
        profile?.namespace ? { ...entry, namespace: profile.namespace } : entry
      );
      return result;
    } catch (error) {
      const entry = {
        action: "tool_call",
        status: "error",
        profileName: route.profileName,
        toolName: route.namespacedName,
        upstreamName: route.upstreamName,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      } as const;
      await safeAuditLog(
        this.auditLogger,
        profile?.namespace ? { ...entry, namespace: profile.namespace } : entry
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
}
