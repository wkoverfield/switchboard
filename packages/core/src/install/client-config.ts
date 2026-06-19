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

export interface ClientConfigValidationResult {
  ok: boolean;
  errors: string[];
}

const defaultServerName = "switchboard";
const defaultCommand = "switchboard";

export function renderSwitchboardClientConfig(
  options: SwitchboardClientConfigOptions
): RenderedClientConfig {
  const serverName = options.serverName ?? defaultServerName;
  const command = options.command ?? defaultCommand;
  const args = ["--cwd", options.cwd, "mcp"];
  const validation = validateSwitchboardClientConfigOptions({
    ...options,
    serverName,
    command
  });

  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }

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

export function validateSwitchboardClientConfigOptions(
  options: SwitchboardClientConfigOptions
): ClientConfigValidationResult {
  const serverName = options.serverName ?? defaultServerName;
  const command = options.command ?? defaultCommand;
  const errors: string[] = [];

  if (serverName.trim().length === 0) {
    errors.push("server name must not be empty");
  }

  if (containsControlCharacter(serverName)) {
    errors.push("server name must not contain control characters");
  }

  if (command.trim().length === 0) {
    errors.push("command must not be empty");
  }

  if (containsControlCharacter(command)) {
    errors.push("command must not contain control characters");
  }

  return { ok: errors.length === 0, errors };
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
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
