import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import {
  canonicalFacilityKey,
  canonicalStreetKey,
  stateFromAddress,
} from "@/lib/reports/facilityKey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_ID = "app9iYUN8J3z2wjXN";
const FACILITY_TABLE = "tblmun9KBYW4aYBe1";
const CACHE_DIR = path.join(process.cwd(), ".data");
const CACHE_FILE = path.join(CACHE_DIR, "facility-states.json");

interface AtRecord {
  id: string;
  fields: Record<string, unknown>;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && "name" in (v as object))
    return String((v as { name: string }).name);
  return String(v);
}

async function fetchAll(pat: string): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${FACILITY_TABLE}`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.append("fields[]", "FACILITY NAME");
    url.searchParams.append("fields[]", "FACILITY ADDRESS");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { records: AtRecord[]; offset?: string };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

/**
 * Build the facility → state map from Airtable, keyed by both the full
 * canonical facility key and the street key. Full keys are written first; a
 * street key only fills a slot that a full key didn't already take, so precise
 * matches always win.
 */
function buildMap(records: AtRecord[]): Record<string, string> {
  const map: Record<string, string> = {};
  const streets: Array<[string, string]> = [];
  for (const r of records) {
    const name = str(r.fields["FACILITY NAME"]);
    const state = stateFromAddress(str(r.fields["FACILITY ADDRESS"]));
    if (!name || !state) continue;
    const key = canonicalFacilityKey(name);
    if (key) map[key] = state;
    const sk = canonicalStreetKey(name);
    if (sk) streets.push([sk, state]);
  }
  for (const [sk, state] of streets) {
    if (!(sk in map)) map[sk] = state;
  }
  return map;
}

async function readCache(): Promise<Record<string, string> | null> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(map: Record<string, string>): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(map), "utf8");
  } catch {
    // best-effort cache; ignore write failures
  }
}

/**
 * Returns a { canonicalFacilityKey: "MA"|"IL"|"DC" } map so the Gather Data
 * report can show each facility's state — even for call-log rows that carry no
 * state. Served from a `.data` cache; refreshed from Airtable when a PAT is
 * available (header `x-airtable-pat` or env `AIRTABLE_PAT`) and the cache is
 * missing or `?refresh=1` is passed. The shared `/gather` page (no PAT) reads
 * the cached map, so populate it once from a machine that has the PAT.
 */
export async function GET(req: Request) {
  const pat =
    req.headers.get("x-airtable-pat") || process.env.AIRTABLE_PAT || "";
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  if (!refresh) {
    const cached = await readCache();
    if (cached) {
      return Response.json({ states: cached, count: Object.keys(cached).length, cached: true });
    }
  }

  if (!pat) {
    // No way to build the map and nothing cached — return empty so the report
    // still renders (states fall back to whatever the upload provides).
    return Response.json({ states: {}, count: 0, cached: false });
  }

  try {
    const records = await fetchAll(pat);
    const map = buildMap(records);
    await writeCache(map);
    return Response.json({ states: map, count: Object.keys(map).length, cached: false });
  } catch (e) {
    const cached = await readCache();
    if (cached) {
      return Response.json({ states: cached, count: Object.keys(cached).length, cached: true });
    }
    return Response.json(
      { states: {}, count: 0, error: e instanceof Error ? e.message : "fetch failed" },
      { status: 200 },
    );
  }
}
