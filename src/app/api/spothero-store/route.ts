import {
  appendSpotHeroRows,
  appendFacilityFinancials,
  storedFileNames,
  type SpotHeroRow,
  type FacilityFinancial,
} from "@/lib/complaints/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Persist the report-relevant SpotHero data for one uploaded file: raw rows +
 * per-facility financial summary. De-duplicated by fileName, so re-uploading
 * the same file is a no-op (returns skipped).
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    fileName?: string;
    rows?: SpotHeroRow[];
    financials?: FacilityFinancial[];
  };
  const fileName = (b.fileName || "").trim();
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const financials = Array.isArray(b.financials) ? b.financials : [];
  if (!fileName) return Response.json({ error: "fileName_required" }, { status: 400 });

  try {
    const existing = await storedFileNames();
    if (existing.has(fileName)) {
      return Response.json({ ok: true, skipped: true, reason: "already stored" });
    }
    // Financials first (small); then the raw rows (larger).
    await appendFacilityFinancials(financials);
    await appendSpotHeroRows(rows);
    return Response.json({ ok: true, storedRows: rows.length, storedFacilities: financials.length });
  } catch (e) {
    return Response.json(
      { error: "store_failed", description: e instanceof Error ? e.message : "could not store to database" },
      { status: 502 },
    );
  }
}
