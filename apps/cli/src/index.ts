#!/usr/bin/env node
import { createJsonlAuditLogger } from "@switchboard-mcp/core";
import { createProgram } from "./program.js";

try {
  await createProgram({ auditLogger: createJsonlAuditLogger() }).parseAsync(
    process.argv
  );
} catch (error) {
  if (isCommanderExit(error)) {
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}

function isCommanderExit(error: unknown): error is { exitCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    typeof error.exitCode === "number"
  );
}
