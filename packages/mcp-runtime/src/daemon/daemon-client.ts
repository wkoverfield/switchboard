import { createConnection } from "node:net";
import {
  CallToolResultSchema,
  type CallToolResult
} from "@modelcontextprotocol/sdk/types.js";
import type { NamespacedTool } from "../runtime/namespaced-tools.js";

export interface DaemonPingResponse {
  id: string;
  ok: true;
  type: "pong";
  version: string;
}

export interface DaemonToolsResponse {
  id: string;
  ok: true;
  type: "tools";
  version: string;
  tools: NamespacedTool[];
}

export interface DaemonToolCallResponse {
  id: string;
  ok: true;
  type: "tool_result";
  version: string;
  result: CallToolResult;
}

export interface DaemonErrorResponse {
  id: string;
  ok: false;
  error: string;
}

export type DaemonResponse =
  | DaemonPingResponse
  | DaemonToolsResponse
  | DaemonToolCallResponse
  | DaemonErrorResponse;

export type DaemonRequest =
  | { id: string; type: "ping" }
  | { id: string; type: "list_tools"; mandateId?: string }
  | {
      id: string;
      type: "call_tool";
      name: string;
      arguments?: Record<string, unknown>;
      mandateId?: string;
      approvalWaitMs?: number;
    };

export interface DaemonClientOptions {
  timeoutMs?: number;
  mandateId?: string;
  approvalWaitMs?: number;
}

export async function pingDaemon(
  socketPath: string,
  options: DaemonClientOptions = {}
): Promise<DaemonPingResponse> {
  const id = randomRequestId();
  const response = await requestDaemon(socketPath, {
    id,
    type: "ping"
  }, options);

  if (response.id !== id) {
    throw new Error("Daemon response id did not match request id.");
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  if (response.type !== "pong") {
    throw new Error("Unexpected daemon response.");
  }

  return response;
}

export async function listDaemonTools(
  socketPath: string,
  options: DaemonClientOptions = {}
): Promise<DaemonToolsResponse> {
  const id = randomRequestId();
  const request: DaemonRequest = {
    id,
    type: "list_tools"
  };
  if (options.mandateId) {
    request.mandateId = options.mandateId;
  }
  const response = await requestDaemon(
    socketPath,
    request,
    { timeoutMs: options.timeoutMs ?? 5000 }
  );

  if (response.id !== id) {
    throw new Error("Daemon response id did not match request id.");
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  if (response.type !== "tools") {
    throw new Error("Unexpected daemon response.");
  }

  return response;
}

export async function callDaemonTool(
  socketPath: string,
  name: string,
  args?: Record<string, unknown>,
  options: DaemonClientOptions = {}
): Promise<DaemonToolCallResponse> {
  const id = randomRequestId();
  const request: DaemonRequest = {
    id,
    type: "call_tool",
    name
  };
  if (args !== undefined) {
    request.arguments = args;
  }
  if (options.mandateId) {
    request.mandateId = options.mandateId;
  }
  if (options.approvalWaitMs !== undefined) {
    request.approvalWaitMs = options.approvalWaitMs;
  }
  const response = await requestDaemon(socketPath, request, {
    timeoutMs: options.timeoutMs ?? daemonToolCallTimeoutMs(options)
  });

  if (response.id !== id) {
    throw new Error("Daemon response id did not match request id.");
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  if (response.type !== "tool_result") {
    throw new Error("Unexpected daemon response.");
  }

  return response;
}

export function daemonToolCallTimeoutMs(options: DaemonClientOptions = {}): number {
  return Math.max(60_000, (options.approvalWaitMs ?? 0) + 60_000);
}

export async function requestDaemon(
  socketPath: string,
  request: DaemonRequest,
  options: DaemonClientOptions = {}
): Promise<DaemonResponse> {
  const timeoutMs = options.timeoutMs ?? 500;

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for daemon response."));
    }, timeoutMs);

    socket.setEncoding("utf8");
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\n")) {
        socket.end();
      }
    });
    socket.on("end", () => {
      clearTimeout(timeout);
      try {
        resolve(parseDaemonResponse(response.trim()));
      } catch (error) {
        reject(error);
      }
    });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
  });
}

function randomRequestId(): string {
  return Math.random().toString(16).slice(2);
}

export function parseDaemonResponse(raw: string): DaemonResponse {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Daemon response must be an object.");
  }

  if (!("id" in parsed) || typeof parsed.id !== "string") {
    throw new Error("Daemon response id is missing or invalid.");
  }
  if (!("ok" in parsed) || typeof parsed.ok !== "boolean") {
    throw new Error("Daemon response ok flag is missing or invalid.");
  }

  if (parsed.ok) {
    if (!("type" in parsed) || typeof parsed.type !== "string") {
      throw new Error("Daemon success response type is invalid.");
    }
    if (!("version" in parsed) || typeof parsed.version !== "string") {
      throw new Error("Daemon success response version is missing or invalid.");
    }

    if (parsed.type === "tools") {
      if (!("tools" in parsed) || !Array.isArray(parsed.tools)) {
        throw new Error("Daemon tools response tools are missing or invalid.");
      }

      return {
        id: parsed.id,
        ok: true,
        type: "tools",
        version: parsed.version,
        tools: parsed.tools.map(parseNamespacedTool)
      };
    }

    if (parsed.type === "tool_result") {
      if (!("result" in parsed)) {
        throw new Error("Daemon tool result response result is missing.");
      }
      const result = CallToolResultSchema.safeParse(parsed.result);
      if (!result.success) {
        throw new Error("Daemon tool result response result is invalid.");
      }

      return {
        id: parsed.id,
        ok: true,
        type: "tool_result",
        version: parsed.version,
        result: result.data
      };
    }

    if (parsed.type !== "pong") {
      throw new Error("Daemon success response type is invalid.");
    }

    return {
      id: parsed.id,
      ok: true,
      type: "pong",
      version: parsed.version
    };
  }

  if (!("error" in parsed) || typeof parsed.error !== "string") {
    throw new Error("Daemon error response message is missing or invalid.");
  }

  return {
    id: parsed.id,
    ok: false,
    error: parsed.error
  };
}

function parseNamespacedTool(value: unknown): NamespacedTool {
  if (typeof value !== "object" || value === null) {
    throw new Error("Daemon tools response contains an invalid tool.");
  }

  const tool = value as Record<string, unknown>;
  if (
    typeof tool.name !== "string" ||
    typeof tool.profileName !== "string" ||
    typeof tool.namespace !== "string" ||
    typeof tool.upstreamName !== "string"
  ) {
    throw new Error("Daemon tools response contains an invalid tool identity.");
  }
  if (!isToolSchema(tool.inputSchema)) {
    throw new Error("Daemon tools response contains an invalid tool schema.");
  }

  const parsed: NamespacedTool = {
    name: tool.name,
    profileName: tool.profileName,
    namespace: tool.namespace,
    upstreamName: tool.upstreamName,
    inputSchema: tool.inputSchema
  };

  if (typeof tool.description === "string") {
    parsed.description = tool.description;
  }
  if (isToolSchema(tool.outputSchema)) {
    parsed.outputSchema = tool.outputSchema;
  }
  if (isRecord(tool.annotations)) {
    parsed.annotations = tool.annotations;
  }
  if (typeof tool.title === "string") {
    parsed.title = tool.title;
  }
  if (isRecord(tool._meta)) {
    parsed._meta = tool._meta;
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolSchema(value: unknown): value is NamespacedTool["inputSchema"] {
  return isRecord(value) && value.type === "object";
}
