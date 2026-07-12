import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDocStore } from "./doc-store.js";

async function makeBundle() {
  const bundleDir = await mkdtemp(join(tmpdir(), "switchboard-docs-"));
  const docs = [
    {
      path: "security/threat-model.md",
      title: "Threat Model",
      description: "STRIDE analysis.",
      content: "# Threat Model\n\nSwitchboard is not a sandbox.\nRevocation is next-call.\n"
    },
    {
      path: "roadmap.md",
      title: "Roadmap",
      description: "Shipped, next, later.",
      content: "# Roadmap\n\nOrg model is later.\nPolicy engine is later.\n"
    }
  ];
  for (const doc of docs) {
    await mkdir(dirname(join(bundleDir, doc.path)), { recursive: true });
    await writeFile(join(bundleDir, doc.path), doc.content);
  }
  await writeFile(
    join(bundleDir, "index.json"),
    JSON.stringify({
      version: 1,
      docs: docs.map(({ path, title, description }) => ({ path, title, description }))
    })
  );
  return bundleDir;
}

describe("doc store", () => {
  it("lists, reads, and searches bundled docs", async () => {
    const store = await loadDocStore(await makeBundle());

    expect(store.listDocs()).toHaveLength(2);
    expect(store.listDocs()[0]).toMatchObject({ path: "security/threat-model.md" });

    const content = await store.readDoc("security/threat-model.md");
    expect(content).toContain("not a sandbox");

    const hits = await store.searchDocs("sandbox");
    expect(hits).toMatchObject([
      { path: "security/threat-model.md", line: 3 }
    ]);

    const multiTerm = await store.searchDocs("policy later");
    expect(multiTerm).toMatchObject([{ path: "roadmap.md" }]);
  });

  it("rejects unknown doc paths with the known list", async () => {
    const store = await loadDocStore(await makeBundle());

    await expect(store.readDoc("nope.md")).rejects.toThrow(/unknown doc/);
    await expect(store.readDoc("../secrets")).rejects.toThrow(/unknown doc/);
  });

  it("returns no hits for an empty query", async () => {
    const store = await loadDocStore(await makeBundle());
    expect(await store.searchDocs("  ")).toEqual([]);
  });
});
