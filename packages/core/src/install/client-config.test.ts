import { describe, expect, it } from "vitest";
import { renderSwitchboardClientConfig } from "./client-config.js";

describe("renderSwitchboardClientConfig", () => {
  it("renders Codex TOML for the Switchboard stdio front door", () => {
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
        'args = ["--cwd", "/repo/switchboard", "serve"]',
        'cwd = "/repo/switchboard"',
        "startup_timeout_sec = 20",
        "tool_timeout_sec = 60"
      ].join("\n")
    });
  });

  it("renders Claude Code JSON for the Switchboard stdio front door", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "claude",
      cwd: "/repo/switchboard"
    });

    expect(JSON.parse(rendered.content)).toEqual({
      mcpServers: {
        switchboard: {
          command: "switchboard",
          args: ["--cwd", "/repo/switchboard", "serve"],
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
      'args = ["--cwd", "/repo/with spaces", "serve"]'
    );
  });
});
