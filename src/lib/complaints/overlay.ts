// Per-complaint overlay: root cause + resolution status/date. Stored locally and
// merged onto complaints at read time (Airtable complaints are read-only, so we
// keep these editable attributes in our own store, keyed by complaint).

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export interface Overlay {
  rootCause?: string;
  resolutionStatus?: string; // Open | Closed
  resolutionDate?: string; // ISO
}
export type OverlayMap = Record<string, Overlay>;

const CACHE_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(CACHE_DIR, "complaint-overlay.json");

export async function readOverlay(): Promise<OverlayMap> {
  try {
    const p = JSON.parse(await readFile(FILE, "utf8"));
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

export async function writeOverlay(map: OverlayMap): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(map), "utf8");
}
