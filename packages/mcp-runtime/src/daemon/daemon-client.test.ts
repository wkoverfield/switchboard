import { describe, expect, it } from "vitest";
import { parseDaemonResponse } from "./daemon-client.js";

describe("daemon client response validation", () => {
  it("accepts valid pong responses", () => {
    expect(
      parseDaemonResponse(
        JSON.stringify({
          id: "one",
          ok: true,
          type: "pong",
          version: "0.1.0"
        })
      )
    ).toEqual({
      id: "one",
      ok: true,
      type: "pong",
      version: "0.1.0"
    });
  });

  it("accepts valid tool list responses", () => {
    expect(
      parseDaemonResponse(
        JSON.stringify({
          id: "tools",
          ok: true,
          type: "tools",
          version: "0.1.0",
          tools: [
            {
              name: "fixture_echo",
              profileName: "fixture",
              namespace: "fixture",
              upstreamName: "echo",
              description: "Echo input.",
              inputSchema: { type: "object" }
            }
          ]
        })
      )
    ).toEqual({
      id: "tools",
      ok: true,
      type: "tools",
      version: "0.1.0",
      tools: [
        {
          name: "fixture_echo",
          profileName: "fixture",
          namespace: "fixture",
          upstreamName: "echo",
          description: "Echo input.",
          inputSchema: { type: "object" }
        }
      ]
    });
  });

  it("rejects malformed success responses", () => {
    expect(() =>
      parseDaemonResponse(JSON.stringify({ id: "one", ok: true, type: "pong" }))
    ).toThrow("Daemon success response version is missing or invalid.");
  });

  it("rejects malformed error responses", () => {
    expect(() =>
      parseDaemonResponse(JSON.stringify({ id: "one", ok: false }))
    ).toThrow("Daemon error response message is missing or invalid.");
  });

  it("rejects responses without a string id", () => {
    expect(() =>
      parseDaemonResponse(
        JSON.stringify({ ok: true, type: "pong", version: "0.1.0" })
      )
    ).toThrow("Daemon response id is missing or invalid.");
  });

  it("rejects malformed tool list responses", () => {
    expect(() =>
      parseDaemonResponse(
        JSON.stringify({
          id: "tools",
          ok: true,
          type: "tools",
          version: "0.1.0",
          tools: [
            {
              name: "fixture_echo",
              profileName: "fixture",
              namespace: "fixture",
              upstreamName: "echo"
            }
          ]
        })
      )
    ).toThrow("Daemon tools response contains an invalid tool schema.");
  });
});
