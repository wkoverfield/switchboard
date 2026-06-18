import { describe, expect, it } from "vitest";
import {
  detectNamespaceCollisions,
  namespaceForProfile,
  slugifyNamespace
} from "./namespaces.js";

describe("namespaces", () => {
  it("normalizes namespaces to stable snake case", () => {
    expect(slugifyNamespace(" Supabase FindU Dev! ")).toBe(
      "supabase_findu_dev"
    );
  });

  it("uses explicit namespaces when provided", () => {
    expect(
      namespaceForProfile("supabase_findu_dev", {
        provider: "supabase",
        namespace: "FindU Dev"
      })
    ).toEqual({
      profile: "supabase_findu_dev",
      namespace: "findu_dev",
      generated: false
    });
  });

  it("generates namespaces from profile names", () => {
    expect(
      namespaceForProfile("Stripe Live", {
        provider: "stripe",
        environment: "live"
      })
    ).toEqual({
      profile: "Stripe Live",
      namespace: "stripe_live",
      generated: true
    });
  });

  it("detects collisions after normalization", () => {
    expect(
      detectNamespaceCollisions({
        "stripe-live": { provider: "stripe" },
        stripe_live: { provider: "stripe" },
        github_findu: { provider: "github" }
      })
    ).toEqual([
      {
        namespace: "stripe_live",
        profiles: ["stripe-live", "stripe_live"]
      }
    ]);
  });
});
