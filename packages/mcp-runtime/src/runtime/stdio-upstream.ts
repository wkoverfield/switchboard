import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters
} from "@modelcontextprotocol/sdk/client/stdio.js";

export interface StdioUpstreamProfile {
  profileName: string;
  namespace: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type UpstreamTool = Awaited<
  ReturnType<Client["listTools"]>
>["tools"][number];

export type UpstreamToolResult = Awaited<ReturnType<Client["callTool"]>>;

export class StdioUpstreamConnection {
  private readonly client: Client;
  private readonly transport: StdioClientTransport;
  private connected = false;

  constructor(readonly profile: StdioUpstreamProfile) {
    const serverParameters: StdioServerParameters = {
      command: profile.command,
      stderr: "pipe"
    };
    if (profile.args) {
      serverParameters.args = profile.args;
    }
    if (profile.cwd) {
      serverParameters.cwd = profile.cwd;
    }
    if (profile.env) {
      serverParameters.env = profile.env;
    }

    this.client = new Client({
      name: "switchboard-mcp-runtime",
      version: "0.1.0"
    });
    this.transport = new StdioClientTransport(serverParameters);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.client.connect(this.transport);
    this.connected = true;
  }

  async listTools(): Promise<UpstreamTool[]> {
    await this.connect();
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>
  ): Promise<UpstreamToolResult> {
    await this.connect();
    return this.client.callTool({
      name,
      arguments: args
    });
  }

  async close(): Promise<void> {
    if (!this.connected) {
      return;
    }

    await this.transport.close();
    this.connected = false;
  }
}
