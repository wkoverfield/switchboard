export type SupportedClient = "codex" | "claude";

export interface SwitchboardClientConfigOptions {
  client: SupportedClient;
  serverName?: string;
  command?: string;
  cwd: string;
}

export interface RenderedClientConfig {
  client: SupportedClient;
  serverName: string;
  target: string;
  content: string;
}

const defaultServerName = "switchboard";
const defaultCommand = "switchboard";

export function renderSwitchboardClientConfig(
  options: SwitchboardClientConfigOptions
): RenderedClientConfig {
  const serverName = options.serverName ?? defaultServerName;
  const command = options.command ?? defaultCommand;
  const args = ["--cwd", options.cwd, "serve"];

  if (options.client === "codex") {
    return {
      client: "codex",
      serverName,
      target: "~/.codex/config.toml or .codex/config.toml",
      content: renderCodexConfig({ serverName, command, args, cwd: options.cwd })
    };
  }

  return {
    client: "claude",
    serverName,
    target: ".mcp.json for project scope or ~/.claude.json for local/user scope",
    content: JSON.stringify(
      {
        mcpServers: {
          [serverName]: {
            command,
            args,
            env: {}
          }
        }
      },
      null,
      2
    )
  };
}

function renderCodexConfig(options: {
  serverName: string;
  command: string;
  args: string[];
  cwd: string;
}): string {
  return [
    `[mcp_servers.${tomlKey(options.serverName)}]`,
    `command = ${tomlString(options.command)}`,
    `args = ${tomlArray(options.args)}`,
    `cwd = ${tomlString(options.cwd)}`,
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 60"
  ].join("\n");
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlKey(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
