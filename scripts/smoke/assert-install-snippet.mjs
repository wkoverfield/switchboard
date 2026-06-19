import { readFileSync } from "node:fs";
import process from "node:process";

const [client, inputPath] = process.argv.slice(2);

if (!client || !inputPath) {
  process.stderr.write(
    "Usage: node scripts/smoke/assert-install-snippet.mjs <client> <json-file>\n",
  );
  process.exit(1);
}

const payload = JSON.parse(readFileSync(inputPath, "utf8"));

if (payload.client !== client) {
  process.stderr.write(`Expected client ${client}, got ${String(payload.client)}.\n`);
  process.exit(1);
}

if (typeof payload.content !== "string") {
  process.stderr.write("Expected install output to include string content.\n");
  process.exit(1);
}

if (!payload.content.includes('"--cwd"') || !payload.content.includes('"mcp"')) {
  process.stderr.write("Expected install snippet args to include --cwd and mcp.\n");
  process.exit(1);
}

if (payload.content.includes('"serve"')) {
  process.stderr.write("Expected install snippet to use mcp, not serve.\n");
  process.exit(1);
}
