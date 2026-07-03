// Extract the report-relevant SpotHero data (raw rows + per-facility financial
// summary) from uploaded accounting CSVs, so it can be persisted to the database
// for future checking without re-uploading. Reuses the merge pipeline, so the
// net remit comes from the corrected "net total remit" column.

import type { ParsedCsv } from "@/types/data";
import { mergeReportFiles } from "./merge";
import { parseMoney, toIsoDate } from "./columns";
import { categoryForReason } from "./filters";
import type { SpotHeroRow, FacilityFinancial } from "@/lib/complaints/store";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Build {rows, financials} for storage from uploaded SpotHero CSV files. */
export function extractSpotHeroData(
  files: ParsedCsv[],
  fileName: string,
  uploadDate: string,
): { rows: SpotHeroRow[]; financials: FacilityFinancial[]; period: string } {
  const merged = mergeReportFiles(files.map((f) => ({ data: f, source: "spothero" as const })));
  const src = merged.rows;

  // Period = the date span covered by the rows (YYYY-MM-DD..YYYY-MM-DD).
  let min = "", max = "";
  for (const r of src) {
    const iso = toIsoDate(String(r.starts ?? ""));
    if (!iso) continue;
    if (!min || iso < min) min = iso;
    if (!max || iso > max) max = iso;
  }
  const period = min && max ? (min === max ? min : `${min}..${max}`) : "";

  const rows: SpotHeroRow[] = src.map((r) => ({
    rentalId: String(r.rentalId ?? ""),
    facility: String(r.spot ?? ""),
    date: String(r.starts ?? ""),
    state: String(r.state ?? ""),
    reason: String(r.reason ?? ""),
    category: categoryForReason(String(r.reason ?? "")),
    refund: String(r.refund ?? ""),
    netRemit: String(r.totalRemit ?? ""),
    fileName,
    uploadDate,
  }));

  const fin = new Map<string, FacilityFinancial>();
  for (const r of src) {
    const facility = String(r.spot ?? "").trim();
    if (!facility) continue;
    const e = fin.get(facility) ?? {
      fileName, uploadDate, period, facility,
      state: String(r.state ?? ""), netRemit: 0, refund: 0, reservations: 0, lotFull: 0, inacc: 0,
    };
    e.netRemit += parseMoney(String(r.totalRemit ?? ""));
    e.refund += parseMoney(String(r.refund ?? ""));
    e.reservations += 1;
    const cat = categoryForReason(String(r.reason ?? ""));
    if (cat === "lot_full") e.lotFull++;
    else if (cat === "inaccessibility") e.inacc++;
    if (!e.state && r.state) e.state = String(r.state);
    fin.set(facility, e);
  }
  const financials = [...fin.values()].map((e) => ({ ...e, netRemit: round2(e.netRemit), refund: round2(e.refund) }));

  return { rows, financials, period };
}
