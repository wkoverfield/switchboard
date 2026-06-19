import { readFileSync } from "node:fs";
import process from "node:process";

const inputPath = process.argv[2];
const input = inputPath ? readFileSync(inputPath, "utf8") : readFileSync(0, "utf8");
const status = JSON.parse(input);

if (!status.repoConfigPath) {
  process.stderr.write("Expected switchboard status to discover .switchboard.yaml.\n");
  process.exit(1);
}

if (status.profileCount < 1) {
  process.stderr.write("Expected repo .switchboard.yaml to define at least one profile.\n");
  process.exit(1);
}

if (!Array.isArray(status.namespaces) || status.namespaces.length < 1) {
  process.stderr.write("Expected repo .switchboard.yaml to produce a namespace.\n");
  process.exit(1);
}
