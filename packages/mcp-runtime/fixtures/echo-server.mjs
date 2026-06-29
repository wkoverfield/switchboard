#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { z } from "zod";

const label = process.argv[2] ?? "fixture";
const secretEnvName = process.argv[3];
const expectedSecretHash = process.argv[4];
const extraToolNames = process.argv.slice(5);
const callLogPath = process.env.SWITCHBOARD_FIXTURE_CALL_LOG;

const server = new McpServer({
  name: `switchboard-${label}-fixture`,
  version: "0.1.0"
});

server.registerTool(
  "echo",
  {
    description: `Echo a message from ${label}.`,
    inputSchema: z.object({
      message: z.string().default("")
    })
  },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: `${label}:${message}`
      }
    ]
  })
);

server.registerTool(
  "whoami",
  {
    description: `Return the fixture server label for ${label}.`
  },
  async () => ({
    content: [
      {
        type: "text",
        text: label
      }
    ]
  })
);

if (secretEnvName) {
  server.registerTool(
    "secret_status",
    {
      description: `Report whether ${secretEnvName} matches the expected value without returning it.`
    },
    async () => ({
      content: [
        {
          type: "text",
          text: secretStatus(secretEnvName, expectedSecretHash)
        }
      ]
    })
  );
}

for (const toolName of extraToolNames) {
  server.registerTool(
    toolName,
    {
      description: `Synthetic ${toolName} tool from ${label}.`,
      inputSchema: z.object({
        message: z.string().default("")
      })
    },
    async ({ message }) => ({
      content: toolResult(toolName, `${label}:${toolName}:${message}`)
    })
  );
}

await server.connect(new StdioServerTransport());

function secretStatus(envName, expectedHash) {
  const value = process.env[envName];
  if (!value) {
    return "secret:missing";
  }

  if (!expectedHash) {
    return "secret:present";
  }

  return sha256(value) === expectedHash ? "secret:match" : "secret:mismatch";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toolResult(toolName, text) {
  if (callLogPath) {
    appendFileSync(callLogPath, `${toolName}\n`);
  }

  return [
    {
      type: "text",
      text
    }
  ];
}
