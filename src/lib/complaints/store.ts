// Storage abstraction for the SpotHero complaint history + upload log.
//
// Backed by a local `.data/complaint-history.json` file today. To migrate to
// Airtable later, reimplement ONLY this module (readStore/writeStore) — the
// ComplaintRecord schema already mirrors a future Airtable table.

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import type { HistoryStore } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(CACHE_DIR, "complaint-history.json");

const EMPTY: HistoryStore = { complaints: [], uploads: [] };

export async function readStore(): Promise<HistoryStore> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as HistoryStore;
    return {
      complaints: Array.isArray(parsed.complaints) ? parsed.complaints : [],
      uploads: Array.isArray(parsed.uploads) ? parsed.uploads : [],
    };
  } catch {
    return { ...EMPTY, complaints: [], uploads: [] };
  }
}

export async function writeStore(store: HistoryStore): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(store), "utf8");
}
