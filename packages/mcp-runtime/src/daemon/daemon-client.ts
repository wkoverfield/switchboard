import { createConnection } from "node:net";

export interface DaemonPingResponse {
  id: string;
  ok: true;
  type: "pong";
  version: string;
}

export interface DaemonErrorResponse {
  id: string;
  ok: false;
  error: string;
}

export type DaemonResponse = DaemonPingResponse | DaemonErrorResponse;

export interface DaemonClientOptions {
  timeoutMs?: number;
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

export async function requestDaemon(
  socketPath: string,
  request: { id: string; type: string },
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
    if (!("type" in parsed) || parsed.type !== "pong") {
      throw new Error("Daemon success response type is invalid.");
    }
    if (!("version" in parsed) || typeof parsed.version !== "string") {
      throw new Error("Daemon success response version is missing or invalid.");
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
