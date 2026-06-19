import { describe, expect, it } from "vitest";
import {
  renderSwitchboardClientConfig,
  validateSwitchboardClientConfigOptions
} from "./client-config.js";

describe("renderSwitchboardClientConfig", () => {
  it("renders Codex TOML for the daemon-backed Switchboard MCP adapter", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "codex",
      cwd: "/repo/switchboard"
    });

    expect(rendered).toEqual({
      client: "codex",
      serverName: "switchboard",
      target: "~/.codex/config.toml or .codex/config.toml",
      content: [
        '[mcp_servers."switchboard"]',
        'command = "switchboard"',
        'args = ["--cwd", "/repo/switchboard", "mcp"]',
        'cwd = "/repo/switchboard"',
        "startup_timeout_sec = 20",
        "tool_timeout_sec = 60"
      ].join("\n")
    });
  });

  it("renders Claude Code JSON for the daemon-backed Switchboard MCP adapter", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "claude",
      cwd: "/repo/switchboard"
    });

    expect(JSON.parse(rendered.content)).toEqual({
      mcpServers: {
        switchboard: {
          command: "switchboard",
          args: ["--cwd", "/repo/switchboard", "mcp"],
          env: {}
        }
      }
    });
  });

  it("escapes custom Codex server names and commands", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "codex",
      serverName: 'switch"board\\local',
      command: "/usr/local/bin/switchboard",
      cwd: "/repo/with spaces"
    });

    expect(rendered.content).toContain('[mcp_servers."switch\\"board\\\\local"]');
    expect(rendered.content).toContain(
      'command = "/usr/local/bin/switchboard"'
    );
    expect(rendered.content).toContain(
      'args = ["--cwd", "/repo/with spaces", "mcp"]'
    );
  });

  it("rejects empty and control-character config values", () => {
    expect(
      validateSwitchboardClientConfigOptions({
        client: "codex",
        serverName: "switchboard\nlocal",
        command: "",
        cwd: "/repo"
      })
    ).toEqual({
      ok: false,
      errors: [
        "server name must not contain control characters",
        "command must not be empty"
      ]
    });

    expect(() =>
      renderSwitchboardClientConfig({
        client: "codex",
        serverName: "\n",
        cwd: "/repo"
      })
    ).toThrow(
      [
        "server name must not be empty",
        "server name must not contain control characters"
      ].join("\n")
    );
  });
});
