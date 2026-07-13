#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadDocStore } from "./doc-store.js";

// dist/index.js sits one level under the package root; docs-bundle/ is a
// sibling of dist/ in the published package.
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bundleDir = join(packageRoot, "docs-bundle");

const store = await loadDocStore(bundleDir);

const server = new McpServer({
  name: "switchboard-docs",
  version: "0.1.0"
});

server.registerTool(
  "list_docs",
  {
    description:
      "List the Switchboard docs available to read: path, title, and a one-line description each."
  },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(store.listDocs(), null, 2)
      }
    ]
  })
);

server.registerTool(
  "read_doc",
  {
    description:
      "Read one Switchboard doc in full by its path from list_docs (for example security/threat-model.md).",
    inputSchema: z.object({
      path: z.string().describe("Doc path from list_docs")
    })
  },
  async ({ path }) => {
    try {
      return {
        content: [{ type: "text", text: await store.readDoc(path) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "read failed"
          }
        ]
      };
    }
  }
);

server.registerTool(
  "search_docs",
  {
    description:
      "Search every Switchboard doc for lines matching all terms in the query. Returns path, line, and snippet.",
    inputSchema: z.object({
      query: z.string().describe("Space-separated terms; all must match a line")
    })
  },
  async ({ query }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(await store.searchDocs(query), null, 2)
      }
    ]
  })
);

await server.connect(new StdioServerTransport());
