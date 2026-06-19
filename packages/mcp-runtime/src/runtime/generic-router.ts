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

export class GenericMcpRouter {
  private readonly connections = new Map<string, StdioUpstreamConnection>();
  private routes = new Map<string, ToolRoute>();

  constructor(private readonly profiles: StdioUpstreamProfile[]) {
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
    return connection.callTool(route.upstreamName, args);
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
