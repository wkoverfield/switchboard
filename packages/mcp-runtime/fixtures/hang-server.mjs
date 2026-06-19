#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import process from "node:process";
import { setInterval } from "node:timers";

const pidFile = process.argv[2];
if (pidFile) {
  writeFileSync(pidFile, String(process.pid));
}

setInterval(() => {}, 1_000);
