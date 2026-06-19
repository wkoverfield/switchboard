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
});
