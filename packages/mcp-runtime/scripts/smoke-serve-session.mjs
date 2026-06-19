#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "..", "..");
const fixtureServerPath = resolve(packageDir, "fixtures", "echo-server.mjs");
const tmpRoot = join(
  tmpdir(),
  `switchboard-serve-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, ".gitignore"), ".switchboard.local.yaml\n");
writeFileSync(
  join(tmpRoot, ".switchboard.yaml"),
  [
    "version: 1",
    "profiles:",
    "  smoke_echo:",
    "    provider: generic",
    "    namespace: smoke_echo",
    "    upstream:",
    "      type: stdio",
    `      command: ${JSON.stringify(process.execPath)}`,
    "      args:",
    `        - ${JSON.stringify(fixtureServerPath)}`,
    "        - smoke"
  ].join("\n")
);

const client = new Client({
  name: "switchboard-serve-smoke",
  version: "0.1.0"
});
const transport = new StdioClientTransport({
  command: "pnpm",
  args: [
    "--silent",
    "--filter",
    "@switchboard-mcp/cli",
    "switchboard",
    "--cwd",
    tmpRoot,
    "serve"
  ],
  cwd: repoRoot,
  stderr: "pipe"
});

transport.stderr?.resume();

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  assert(names.includes("smoke_echo_echo"), "expected smoke_echo_echo tool");
  assert(names.includes("smoke_echo_whoami"), "expected smoke_echo_whoami tool");

  const result = await client.callTool({
    name: "smoke_echo_echo",
    arguments: { message: "ok" }
  });
  assert(textContent(result) === "smoke:ok", "expected routed echo result");
} finally {
  await client.close();
  rmSync(tmpRoot, { recursive: true, force: true });
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
