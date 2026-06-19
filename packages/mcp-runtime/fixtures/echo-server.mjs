#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";
import { z } from "zod";

const label = process.argv[2] ?? "fixture";

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

await server.connect(new StdioServerTransport());
