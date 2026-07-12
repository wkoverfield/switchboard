#!/usr/bin/env node
// Plays the routed agent for the hero demo (examples/switchboard.tape).
//
// Connects to the real Switchboard front door over stdio, exactly the way a
// coding agent's MCP client does, and calls one tool. The outcome rendering
// is demo-side sugar; the allow/deny decision it prints is Switchboard's own.
//
//   node demo-agent.mjs <namespaced_tool> [mandateId]
//
// Runs against the repo the current working directory points at.
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const print = (text) => process.stdout.write(`${text}\n`);
const printErr = (text) => process.stderr.write(`${text}\n`);

const toolName = process.argv[2];
const mandateId = process.argv[3] ?? "fix-ci";

if (!toolName) {
  printErr("usage: demo-agent.mjs <namespaced_tool> [mandateId]");
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(scriptDir, "..", "..", "..", "apps/cli/dist/index.js");
const project = process.cwd();

const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m"
};
const red = (text) => `${ansi.red}${text}${ansi.reset}`;
const green = (text) => `${ansi.green}${text}${ansi.reset}`;
const yellow = (text) => `${ansi.yellow}${text}${ansi.reset}`;
const dim = (text) => `${ansi.dim}${text}${ansi.reset}`;
const bold = (text) => `${ansi.bold}${text}${ansi.reset}`;

const client = new Client({ name: "demo-agent", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cliPath, "--cwd", project, "serve", "--mandate", mandateId],
  cwd: project,
  env: { ...process.env },
  stderr: "pipe"
});

print(dim(`agent → calling ${toolName}`));

let outcome = { kind: "allowed", detail: "" };
try {
  await client.connect(transport);
  // Real MCP clients list before calling; listing also primes the router.
  await client.listTools();
  const result = await client.callTool({ name: toolName, arguments: {} });
  if (result?.isError) {
    outcome = classifyError(textOf(result));
  } else {
    outcome = { kind: "allowed", detail: textOf(result) };
  }
} catch (error) {
  outcome = classifyError(error?.message ?? String(error));
} finally {
  await client.close().catch(() => {});
}

if (outcome.kind === "allowed") {
  print(`${green("✓ allowed")}  response: ${dim(outcome.detail || "(empty)")}`);
  process.exit(0);
}

if (outcome.kind === "approval") {
  print(badge(yellow, "SWITCHBOARD · WAITING FOR APPROVAL", [
    "",
    `  ${bold(toolName)}`,
    "  this call is gated. a human decides, the agent waits.",
    "",
    `  ${dim(outcome.detail)}`,
    ""
  ]));
  process.exit(0);
}

print(badge(red, "SWITCHBOARD · DENIED", [
  "",
  `  ${bold(toolName)}`,
  "  outside this pass. the call never reached the provider.",
  "",
  `  ${dim(outcome.detail)}`,
  ""
]));
process.exit(1);

function classifyError(message) {
  const detail = (message ?? "").split("\n")[0] ?? "";
  if (/approval/i.test(detail)) {
    return { kind: "approval", detail };
  }
  return { kind: "denied", detail };
}

function textOf(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.find((item) => item?.type === "text")?.text ?? "";
  return text;
}

function badge(paintRail, title, body) {
  const rule = `╭─ ${title} ${"─".repeat(Math.max(4, 52 - title.length))}`;
  return [
    paintRail(`╭─ ${bold(title)} ${"─".repeat(Math.max(4, 52 - title.length))}`),
    ...body.map((line) => `${paintRail("│")}${line}`),
    paintRail(`╰${"─".repeat(rule.length - 1)}`)
  ].join("\n");
}
