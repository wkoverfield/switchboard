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
  const response = await requestDaemon(socketPath, {
    id: randomRequestId(),
    type: "ping"
  }, options);

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
        resolve(JSON.parse(response.trim()) as DaemonResponse);
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
