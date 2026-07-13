import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

export interface DocIndexEntry {
  path: string;
  title: string;
  description: string;
}

export interface DocSearchHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

export interface DocStore {
  listDocs(): DocIndexEntry[];
  readDoc(path: string): Promise<string>;
  searchDocs(query: string, options?: { maxHits?: number }): Promise<DocSearchHit[]>;
}

export async function loadDocStore(bundleDir: string): Promise<DocStore> {
  const indexRaw = await readFile(join(bundleDir, "index.json"), "utf8");
  const index = JSON.parse(indexRaw) as { docs: DocIndexEntry[] };
  const docs = index.docs;
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));

  async function readDoc(path: string): Promise<string> {
    const entry = byPath.get(path);
    if (!entry) {
      const known = docs.map((doc) => doc.path).join(", ");
      throw new Error(`unknown doc "${path}". Known docs: ${known}`);
    }
    // The path came from our own index, but normalize defensively anyway.
    const normalized = normalize(entry.path);
    if (normalized.startsWith("..") || normalized.startsWith("/")) {
      throw new Error(`invalid doc path "${path}"`);
    }
    return readFile(join(bundleDir, normalized), "utf8");
  }

  async function searchDocs(
    query: string,
    options: { maxHits?: number } = {}
  ): Promise<DocSearchHit[]> {
    const maxHits = options.maxHits ?? 20;
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (terms.length === 0) {
      return [];
    }

    const hits: DocSearchHit[] = [];
    for (const doc of docs) {
      const content = await readDoc(doc.path);
      const lines = content.split("\n");
      lines.forEach((line, lineIndex) => {
        const lower = line.toLowerCase();
        if (terms.every((term) => lower.includes(term))) {
          hits.push({
            path: doc.path,
            title: doc.title,
            line: lineIndex + 1,
            snippet: line.trim().slice(0, 240)
          });
        }
      });
    }

    return hits.slice(0, maxHits);
  }

  return {
    listDocs: () => docs,
    readDoc,
    searchDocs
  };
}
