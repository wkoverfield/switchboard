#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "..", "..");
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const fixtureServerPath = resolve(packageDir, "fixtures", "echo-server.mjs");
const tmpRoot = join(
  "/tmp",
  `switchboard-daemon-mcp-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const runtimeDir = join(tmpRoot, "runtime");

try {
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(
    join(tmpRoot, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  daemon_mcp:",
      "    provider: generic",
      "    namespace: daemon_mcp",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - daemon-mcp"
    ].join("\n")
  );

  const client = new Client({
    name: "switchboard-daemon-mcp-smoke",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "--cwd", tmpRoot, "mcp", "--runtime-dir", runtimeDir],
    cwd: repoRoot,
    env: {
      ...process.env,
      XDG_STATE_HOME: tmpRoot,
      SWITCHBOARD_RUNTIME_DIR: runtimeDir
    },
    stderr: "pipe"
  });
  transport.stderr?.resume();

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert(names.includes("daemon_mcp_echo"), "expected daemon_mcp_echo tool");
    assert(names.includes("daemon_mcp_whoami"), "expected daemon_mcp_whoami tool");

    const result = await client.callTool({
      name: "daemon_mcp_echo",
      arguments: { message: "forwarded" }
    });
    assert(textContent(result) === "daemon-mcp:forwarded", "expected routed call result");

    const auditLogPath = join(tmpRoot, "switchboard", "logs", "switchboard.jsonl");
    const auditEntries = readFileSync(auditLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert(
      auditEntries.some(
        (entry) =>
          entry.action === "tool_call" &&
          entry.status === "ok" &&
          entry.toolName === "daemon_mcp_echo"
      ),
      "expected daemon routed tool call audit entry"
    );
  } finally {
    await client.close();
  }
} finally {
  runDaemon("stop", { allowFailure: true });
  rmSync(tmpRoot, { recursive: true, force: true });
}

function runDaemon(command, options = {}) {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--cwd",
      tmpRoot,
      "daemon",
      command,
      "--runtime-dir",
      runtimeDir,
      "--json"
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        XDG_STATE_HOME: tmpRoot,
        SWITCHBOARD_RUNTIME_DIR: runtimeDir
      }
    }
  );

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `daemon ${command} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function textContent(result) {
  if (!Array.isArray(result.content)) {
    return "";
  }

  const first = result.content[0];
  if (first?.type !== "text" || typeof first.text !== "string") {
    return "";
  }

  return first.text;
}
