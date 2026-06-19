#!/usr/bin/env node
import { createJsonlAuditLogger } from "@switchboard-mcp/core";
import { createProgram } from "./program.js";

await createProgram({ auditLogger: createJsonlAuditLogger() }).parseAsync(
  process.argv
);
