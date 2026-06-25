// Live internal complaints from Airtable + a facility directory (name → state,
// facility id), reusing the exact table config from /api/internal-issues.

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { canonicalFacilityKey, normalizeState, stateFromAddress } from "@/lib/reports/facilityKey";
import { periodOf } from "./period";
import type { ComplaintRecord, ComplaintType } from "./types";

const BASE_ID = "app9iYUN8J3z2wjXN";
const FACILITY_TABLE = "tblmun9KBYW4aYBe1";
const CACHE_DIR = path.join(process.cwd(), ".data");
const DIR_FILE = path.join(CACHE_DIR, "facility-directory.json");

// Internal-complaint source tables. Each is fetched independently and a
// missing/renamed/inaccessible table is skipped (not fatal), so the sync
// self-heals when the Airtable schema changes. (CUSTOMER INTERACTIONS was
// removed from the base, so it's no longer listed here.)
const SOURCES = [
  { table: "tblViMnfhcqyMKBHU", reason: "REASON FOR CONTACT CATEGORY", origin: "RingCentral Conversations", fields: ["REASON FOR CONTACT CATEGORY", "RENTAL ID", "DATE", "FACILITY", "SOURCE"] },
  { table: "tblRziRjireToOPoF", reason: "REASON CATEGORY", origin: "Refunds & Reimbursements", fields: ["REASON CATEGORY", "RENTAL ID", "DATE", "FACILITY", "STATE", "AMOUNT"] },
];

interface AtRecord { id: string; fields: Record<string, unknown> }
function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && "name" in (v as object)) return String((v as { name: string }).name);
  return String(v);
}
function categoryFor(reason: string): ComplaintType | null {
  const r = reason.toLowerCase();
  if (r.includes("lot full")) {
    // Count every Lot Full reason EXCEPT "LOT FULL - NO RESPONSE" (unconfirmed —
    // the customer never replied, so it isn't treated as a Lot Full case).
    if (r.includes("no response")) return null;
    return "lot_full";
  }
  if (r.includes("inacces") || r.includes("inaces")) return "inaccessibility";
  return null;
}
function toIso(s: string): string {
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const p = Date.parse(s);
  if (Number.isNaN(p)) return "";
  const d = new Date(p);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchAll(pat: string, table: string, fields: string[], formula: string): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${table}`);
    url.searchParams.set("pageSize", "100");
    if (formula) url.searchParams.set("filterByFormula", formula);
    for (const f of fields) url.searchParams.append("fields[]", f);
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { records: AtRecord[]; offset?: string };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

export interface DirEntry { name: string; state: string; facilityId: string }
export type Directory = Record<string, DirEntry>;

/** Build/cache canonicalKey → {name,state,facilityId} from FACILITY INFORMATION. */
export async function getDirectory(pat: string, refresh = false): Promise<Directory> {
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(DIR_FILE, "utf8")) as Directory;
      if (cached && Object.keys(cached).length) return cached;
    } catch { /* no cache */ }
  }
  if (!pat) return {};
  const recs = await fetchAll(pat, FACILITY_TABLE, ["FACILITY NAME", "FACILITY ADDRESS", "FACILITY ID"], "");
  const dir: Directory = {};
  for (const r of recs) {
    const name = str(r.fields["FACILITY NAME"]);
    const key = canonicalFacilityKey(name);
    if (!key) continue;
    dir[key] = {
      name,
      state: normalizeState(stateFromAddress(str(r.fields["FACILITY ADDRESS"])) || "") || "",
      facilityId: str(r.fields["FACILITY ID"]),
    };
  }
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(DIR_FILE, JSON.stringify(dir), "utf8");
  } catch { /* best-effort */ }
  return dir;
}

/** Resolve a facility's directory entry by canonical key (best-effort). */
export function resolveFacilityId(dir: Directory, facilityName: string): string {
  return dir[canonicalFacilityKey(facilityName)]?.facilityId ?? "";
}

/** A canonical, deduped internal complaint. */
export interface InternalComplaint {
  rentalId: string;
  facility: string;
  facilityId: string;
  date: string; // ISO YYYY-MM-DD (never empty)
  category: ComplaintType;
  reason: string;
  source: string; // origin table label
  state: string;
  amount: number;
  origins: string[];
}

/**
 * THE single source of truth for internal Lot Full / Inaccessibility complaints.
 * Both the Gather Data report (/api/internal-issues) and the Facility Progress
 * Checker (/api/complaint-history) call this, so they always show identical
 * internal data. Records with no parseable date or no facility are skipped
 * (they can't be placed in time or attributed to a facility). De-duplicated by
 * Rental ID; blank Rental IDs de-duped on a facility|date|category signature.
 */
export async function gatherInternal(pat: string, dir: Directory): Promise<InternalComplaint[]> {
  const byId = new Map<string, InternalComplaint>();
  const blanks = new Map<string, InternalComplaint>();
  for (const s of SOURCES) {
    const F = `UPPER({${s.reason}})`;
    const formula = `OR(FIND("LOT FULL",${F}),FIND("INACCES",${F}),FIND("INACES",${F}))`;
    let recs: AtRecord[] = [];
    try {
      recs = await fetchAll(pat, s.table, s.fields, formula);
    } catch {
      continue; // missing/renamed/inaccessible table — skip, keep the rest
    }
    for (const r of recs) {
      const reason = str(r.fields[s.reason]);
      const category = categoryFor(reason);
      if (!category) continue;
      const date = toIso(str(r.fields["DATE"]));
      if (!date) continue; // skip undated
      const facility = str(r.fields["FACILITY"]).trim();
      if (!facility) continue; // skip blank facility
      const rentalId = str(r.fields["RENTAL ID"]).trim();
      const rec: InternalComplaint = {
        rentalId,
        facility,
        facilityId: resolveFacilityId(dir, facility),
        date,
        category,
        reason,
        source: s.origin,
        state: str(r.fields["STATE"]),
        amount: Number(r.fields["AMOUNT"]) || 0,
        origins: [s.origin],
      };
      if (rentalId) {
        const ex = byId.get(rentalId);
        if (ex) {
          if (!ex.origins.includes(s.origin)) ex.origins.push(s.origin);
          if (!ex.amount && rec.amount) ex.amount = rec.amount;
          if (!ex.state && rec.state) ex.state = rec.state;
        } else byId.set(rentalId, rec);
      } else {
        const sig = `${facility}|${date}|${category}`;
        if (!blanks.has(sig)) blanks.set(sig, rec);
      }
    }
  }
  return [...byId.values(), ...blanks.values()];
}

/** Internal complaints as ComplaintRecord[] for the Facility Progress Checker. */
export async function fetchInternalComplaints(pat: string, dir: Directory): Promise<ComplaintRecord[]> {
  const now = new Date().toISOString();
  const out: ComplaintRecord[] = [];
  for (const rec of await gatherInternal(pat, dir)) {
    const parts = periodOf(rec.date);
    if (!parts) continue;
    out.push({
      rentalId: rec.rentalId,
      facilityName: rec.facility,
      facilityId: rec.facilityId,
      complaintType: rec.category,
      complaintDate: rec.date,
      source: "Internal",
      resolutionStatus: "Open",
      notes: "",
      uploadDate: now,
      reportingYear: parts.year,
      reportingMonth: parts.month,
      reportingBiweekly: parts.biweekly,
    });
  }
  return out;
}
