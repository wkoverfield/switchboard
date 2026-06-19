import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolResult,
  ListToolsResult,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { listDaemonTools } from "../daemon/daemon-client.js";
import type { GenericMcpRouter } from "./generic-router.js";
import type { NamespacedTool } from "./namespaced-tools.js";
import type { UpstreamToolResult } from "./stdio-upstream.js";

export interface SwitchboardMcpServerOptions {
  name?: string;
  version?: string;
}

export interface DaemonBackedMcpServerOptions extends SwitchboardMcpServerOptions {
  listTools?: () => Promise<NamespacedTool[]>;
}

export function createSwitchboardMcpServer(
  router: GenericMcpRouter,
  options: SwitchboardMcpServerOptions = {}
): Server {
  const server = new Server(
    {
      name: options.name ?? "switchboard",
      version: options.version ?? "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: (await router.discoverTools()).map(toMcpTool)
    })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> =>
      toCallToolResult(
        await router.callTool(request.params.name, request.params.arguments)
      )
  );

  server.onclose = () => {
    void router.close();
  };

  return server;
}

export function createDaemonBackedSwitchboardMcpServer(
  socketPath: string,
  options: DaemonBackedMcpServerOptions = {}
): Server {
  const listTools =
    options.listTools ??
    (async () => {
      const response = await listDaemonTools(socketPath);
      return response.tools;
    });
  const server = new Server(
    {
      name: options.name ?? "switchboard",
      version: options.version ?? "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: (await listTools()).map(toMcpTool)
    })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (): Promise<CallToolResult> => ({
      isError: true,
      content: [
        {
          type: "text",
          text: "Daemon-backed MCP tool calls are not implemented yet; use switchboard serve for routed calls."
        }
      ]
    })
  );

  return server;
}

export async function connectSwitchboardMcpServer(
  router: GenericMcpRouter,
  transport: Transport,
  options: SwitchboardMcpServerOptions = {}
): Promise<Server> {
  const server = createSwitchboardMcpServer(router, options);
  await server.connect(transport);
  return server;
}

export async function connectDaemonBackedSwitchboardMcpServer(
  socketPath: string,
  transport: Transport,
  options: DaemonBackedMcpServerOptions = {}
): Promise<Server> {
  const server = createDaemonBackedSwitchboardMcpServer(socketPath, options);
  await server.connect(transport);
  return server;
}

export async function serveSwitchboardMcpStdio(
  router: GenericMcpRouter,
  options: SwitchboardMcpServerOptions = {}
): Promise<Server> {
  return connectSwitchboardMcpServer(router, new StdioServerTransport(), options);
}

export async function serveDaemonBackedMcpStdio(
  socketPath: string,
  options: DaemonBackedMcpServerOptions = {}
): Promise<Server> {
  return connectDaemonBackedSwitchboardMcpServer(
    socketPath,
    new StdioServerTransport(),
    options
  );
}

function toCallToolResult(result: UpstreamToolResult): CallToolResult {
  const parsed = CallToolResultSchema.safeParse(result);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result.toolResult)
      }
    ]
  };
}

export function toMcpTool(tool: NamespacedTool): Tool {
  const mcpTool: Tool = {
    name: tool.name,
    inputSchema: tool.inputSchema,
    _meta: {
      ...tool._meta,
      switchboard: {
        profileName: tool.profileName,
        namespace: tool.namespace,
        upstreamName: tool.upstreamName
      }
    }
  };

  if (tool.description) {
    mcpTool.description = tool.description;
  }
  if (tool.outputSchema) {
    mcpTool.outputSchema = tool.outputSchema;
  }
  if (tool.annotations) {
    mcpTool.annotations = tool.annotations;
  }
  if (tool.title) {
    mcpTool.title = tool.title;
  }

  return mcpTool;
}
