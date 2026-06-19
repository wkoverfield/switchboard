#!/usr/bin/env node
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath, URL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const runtimeRoot = join(
  "/tmp",
  `switchboard-daemon-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const runtimeDir = join(runtimeRoot, "nested", "runtime");

try {
  const start = run("start");
  assert(start.ok === true, "daemon start should succeed");

  const running = run("status");
  assert(running.state === "running", "daemon should report running");
  assert(typeof running.daemon?.pid === "number", "daemon pid should be present");
  const heartbeat = await ping(running.paths.socketPath);
  assert(heartbeat === "pong", "daemon should answer heartbeat ping");

  const stop = run("stop");
  assert(stop.ok === true, "daemon stop should succeed");

  const stopped = run("status");
  assert(stopped.state === "not-running", "daemon should report not-running");
} finally {
  run("stop", { allowFailure: true });
  rmSync(runtimeRoot, { recursive: true, force: true });
}

function run(command, options = {}) {
  const result = spawnSync(
    process.execPath,
    [cliPath, "daemon", command, "--runtime-dir", runtimeDir, "--json"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SWITCHBOARD_RUNTIME_DIR: runtimeDir
      }
    }
  );

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `daemon ${command} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ping(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = "";

    socket.setEncoding("utf8");
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\n")) {
        socket.end();
      }
    });
    socket.on("end", () => {
      resolve(response.trim());
    });
    socket.on("connect", () => {
      socket.write("ping\n");
    });
  });
}
