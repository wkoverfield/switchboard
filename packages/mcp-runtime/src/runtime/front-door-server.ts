import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolResult,
  ClientCapabilities,
  ElicitRequestFormParams,
  ElicitResult,
  ListToolsResult,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  DaemonRequestError,
  callDaemonTool,
  listDaemonTools,
  type DaemonApprovalRequired
} from "../daemon/daemon-client.js";
import {
  createJsonlAuditLogger,
  decideApprovalRequest,
  safeAuditLog
} from "@switchboard-mcp/core";
import type { GenericMcpRouter } from "./generic-router.js";
import type { NamespacedTool } from "./namespaced-tools.js";
import type { UpstreamToolResult } from "./stdio-upstream.js";

export interface SwitchboardMcpServerOptions {
  name?: string;
  version?: string;
}

export interface DaemonBackedMcpServerOptions extends SwitchboardMcpServerOptions {
  mandateId?: string;
  approvalWaitMs?: number;
  listTools?: () => Promise<NamespacedTool[]>;
  callTool?: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<CallToolResult>;
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
  const listTools =
    options.listTools ??
    (async () => {
      const response = await listDaemonTools(
        socketPath,
        options.mandateId ? { mandateId: options.mandateId } : {}
      );
      return response.tools;
    });
  const callDaemon =
    options.callTool ??
    (async (name: string, args?: Record<string, unknown>) => {
      const response = await callDaemonTool(
        socketPath,
        name,
        args,
        {
          ...(options.mandateId ? { mandateId: options.mandateId } : {}),
          ...(options.approvalWaitMs !== undefined
            ? { approvalWaitMs: options.approvalWaitMs }
            : {})
        }
      );
      return response.result;
    });
  const callTool = async (
    name: string,
    args?: Record<string, unknown>
  ): Promise<CallToolResult> =>
    callDaemonToolWithOptionalElicitation(server, callDaemon, name, args);

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: (await listTools()).map(toMcpTool)
    })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> =>
      callTool(request.params.name, request.params.arguments)
  );

  return server;
}

async function callDaemonToolWithOptionalElicitation(
  server: Server,
  callTool: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<CallToolResult>,
  name: string,
  args?: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    return await callTool(name, args);
  } catch (error) {
    if (
      !(error instanceof DaemonRequestError) ||
      !error.response.approvalRequired ||
      !supportsFormElicitation(server.getClientCapabilities())
    ) {
      throw error;
    }

    return handleApprovalElicitation({
      server,
      callTool,
      toolName: name,
      args,
      error
    });
  }
}

async function handleApprovalElicitation(options: {
  server: Server;
  callTool: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<CallToolResult>;
  toolName: string;
  args: Record<string, unknown> | undefined;
  error: DaemonRequestError;
}): Promise<CallToolResult> {
  const approval = options.error.response.approvalRequired;
  if (!approval) {
    throw options.error;
  }

  const startedAt = Date.now();
  let result: ElicitResult;
  try {
    result = await options.server.elicitInput({
      mode: "form",
      message: approvalElicitationMessage(approval),
      requestedSchema: approvalElicitationSchema()
    });
  } catch (error) {
    await auditApprovalElicitation({
      approval,
      decision: "failed",
      status: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw options.error;
  }

  if (result.action === "decline" || result.action === "cancel") {
    await auditApprovalElicitation({
      approval,
      decision: result.action === "decline" ? "declined" : "cancelled",
      status: "error",
      durationMs: Date.now() - startedAt,
      error: `approval elicitation ${result.action}`
    });
    throw options.error;
  }

  const decision = approvalDecisionFromElicitation(result);
  if (!decision) {
    await auditApprovalElicitation({
      approval,
      decision: "failed",
      status: "error",
      durationMs: Date.now() - startedAt,
      error: "approval elicitation accepted without a valid decision"
    });
    throw options.error;
  }

  const reason = approvalDecisionReasonFromElicitation(result);
  try {
    await decideApprovalRequest({
      id: approval.approvalRequestId,
      status: decision,
      ...(reason ? { reason } : {})
    });
  } catch (error) {
    await auditApprovalElicitation({
      approval,
      decision: "failed",
      status: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw options.error;
  }
  await auditApprovalElicitation({
    approval,
    decision,
    status: decision === "approved" ? "ok" : "error",
    durationMs: Date.now() - startedAt,
    ...(reason ? { error: reason } : {})
  });

  if (decision === "denied") {
    throw new Error(
      `${options.error.response.error}; approval request ${approval.approvalRequestId} was denied by MCP elicitation.`
    );
  }

  return options.callTool(options.toolName, options.args);
}

function supportsFormElicitation(
  capabilities: ClientCapabilities | undefined
): boolean {
  return Boolean(capabilities?.elicitation?.form);
}

function approvalDecisionFromElicitation(
  result: ElicitResult
): "approved" | "denied" | undefined {
  const decision = result.content?.decision;
  if (decision === "approve") {
    return "approved";
  }
  if (decision === "deny") {
    return "denied";
  }

  return undefined;
}

function approvalDecisionReasonFromElicitation(
  result: ElicitResult
): string | undefined {
  const reason = result.content?.reason;
  return typeof reason === "string" && reason.trim().length > 0
    ? reason.trim()
    : undefined;
}

function approvalElicitationSchema(): ElicitRequestFormParams["requestedSchema"] {
  return {
    type: "object",
    properties: {
      decision: {
        type: "string",
        title: "Decision",
        description: "Approve or deny this Switchboard mandate-gated tool call.",
        enum: ["approve", "deny"],
        enumNames: ["Approve", "Deny"]
      },
      reason: {
        type: "string",
        title: "Reason",
        description: "Optional non-secret note for the approval audit trail.",
        maxLength: 500
      }
    },
    required: ["decision"]
  };
}

function approvalElicitationMessage(approval: DaemonApprovalRequired): string {
  const lines = [
    "Switchboard mandate approval required.",
    `Task: ${approval.task}`,
    `Mandate: ${approval.mandateId}`,
    `Repo: ${approval.repoPath}`,
    `Branch: ${approval.branch}`,
    `Agent role: ${approval.agentRole}`,
    `Tool: ${approval.toolName}`,
    `Gate: ${approval.approvalGateId} (${approval.approvalGatePattern})`,
    ...(approval.approvalGateRisk ? [`Risk: ${approval.approvalGateRisk}`] : []),
    ...(approval.approvalGateLabels && approval.approvalGateLabels.length > 0
      ? [`Labels: ${approval.approvalGateLabels.join(", ")}`]
      : []),
    ...(approval.approvalGateReason
      ? [`Reason: ${approval.approvalGateReason}`]
      : []),
    `Approval request: ${approval.approvalRequestId}`,
    `Expires: ${approval.expiresAt}`,
    "Do not enter secrets, API keys, access tokens, passwords, or payment credentials."
  ];

  return lines.join("\n");
}

async function auditApprovalElicitation(options: {
  approval: DaemonApprovalRequired;
  decision: "approved" | "denied" | "declined" | "cancelled" | "failed";
  status: "ok" | "error";
  durationMs: number;
  error?: string;
}): Promise<void> {
  await safeAuditLog(createJsonlAuditLogger(), {
    action: "approval_elicitation",
    status: options.status,
    toolName: options.approval.toolName,
    mandateId: options.approval.mandateId,
    approvalRequestId: options.approval.approvalRequestId,
    approvalGateId: options.approval.approvalGateId,
    approvalGatePattern: options.approval.approvalGatePattern,
    approvalDecision: options.decision,
    durationMs: options.durationMs,
    ...(options.error ? { error: options.error } : {})
  });
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
  const switchboardMeta = isRecord(tool._meta?.switchboard)
    ? tool._meta.switchboard
    : {};
  const mcpTool: Tool = {
    name: tool.name,
    inputSchema: tool.inputSchema,
    _meta: {
      ...tool._meta,
      switchboard: {
        ...switchboardMeta,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
