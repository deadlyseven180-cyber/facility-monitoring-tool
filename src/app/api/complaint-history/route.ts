import { readStore, appendComplaints, appendUpload } from "@/lib/complaints/store";
import { fetchInternalComplaints, getDirectory, resolveFacilityId } from "@/lib/complaints/internal";
import { periodOf } from "@/lib/complaints/period";
import { complaintKey } from "@/lib/complaints/aggregate";
import { readOverlay } from "@/lib/complaints/overlay";
import type { ComplaintRecord, HistoryStore, RawIncident, UploadLog } from "@/lib/complaints/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getPat(req: Request): string {
  return req.headers.get("x-airtable-pat") || process.env.AIRTABLE_PAT || "";
}

const CSV_COLS: (keyof ComplaintRecord)[] = [
  "rentalId", "facilityName", "facilityId", "complaintType", "complaintDate",
  "source", "resolutionStatus", "notes", "uploadDate", "reportingYear",
  "reportingMonth", "reportingBiweekly",
];

function toCsv(rows: ComplaintRecord[]): string {
  const head = CSV_COLS.join(",");
  const lines = rows.map((r) =>
    CSV_COLS.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","),
  );
  return [head, ...lines].join("\n");
}

/**
 * GET — combined complaint history: SpotHero (stored in Airtable) + live
 * Internal (Refunds & Reimbursements). `?export=csv|json` downloads the stored
 * SpotHero history.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const exp = url.searchParams.get("export");
  const pat = getPat(req);

  let store: HistoryStore = { complaints: [], uploads: [] };
  let spotHeroError: string | null = null;
  try {
    store = await readStore();
  } catch (e) {
    spotHeroError = e instanceof Error ? e.message : "spothero load failed";
  }

  if (exp === "csv") {
    return new Response(toCsv(store.complaints), {
      headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="complaint-history.csv"' },
    });
  }
  if (exp === "json") {
    return new Response(JSON.stringify(store.complaints, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="complaint-history.json"' },
    });
  }

  let internal: ComplaintRecord[] = [];
  let internalError: string | null = null;
  if (pat) {
    try {
      const dir = await getDirectory(pat);
      internal = await fetchInternalComplaints(pat, dir);
    } catch (e) {
      internalError = e instanceof Error ? e.message : "internal fetch failed";
    }
  } else {
    internalError = "no_pat";
  }

  // SpotHero history (de-duped at upload, stored in Airtable) + live internal.
  const combined: ComplaintRecord[] = [...store.complaints, ...internal];

  // Apply the per-complaint overlay (root cause + resolution status/date).
  const overlay = await readOverlay();
  for (const rec of combined) {
    const o = overlay[complaintKey(rec)];
    if (!o) continue;
    if (o.rootCause) rec.rootCause = o.rootCause;
    if (o.resolutionStatus) rec.resolutionStatus = o.resolutionStatus;
    if (o.resolutionDate) rec.resolutionDate = o.resolutionDate;
  }

  return Response.json({
    ok: true,
    complaints: combined,
    uploads: store.uploads,
    counts: {
      total: combined.length,
      spotHero: combined.filter((c) => c.source === "SpotHero").length,
      internal: combined.filter((c) => c.source === "Internal").length,
    },
    internalError,
    spotHeroError,
  });
}

/**
 * POST — ingest parsed SpotHero incidents, de-dupe by Rental ID against the
 * Airtable history, store the new rows + an upload-log entry in Airtable.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    fileName?: string; uploadedBy?: string; incidents?: RawIncident[];
  };
  const incidents = Array.isArray(body.incidents) ? body.incidents : [];
  if (incidents.length === 0) return Response.json({ error: "no_incidents" }, { status: 400 });

  // Airtable PAT is only used to resolve facility IDs (best-effort); storage
  // itself goes to Supabase via its own service key.
  const pat = getPat(req);
  const dir = pat ? await getDirectory(pat).catch(() => ({})) : {};
  let store: HistoryStore;
  try {
    store = await readStore();
  } catch (e) {
    return Response.json(
      { error: "load_failed", description: e instanceof Error ? e.message : "could not read existing history" },
      { status: 502 },
    );
  }

  const ids = new Set(store.complaints.filter((c) => c.rentalId).map((c) => c.rentalId));
  const blankSigs = new Set(
    store.complaints.filter((c) => !c.rentalId).map((c) => `${c.facilityName}|${c.complaintDate}|${c.complaintType}`),
  );
  const now = new Date().toISOString();
  const newRecords: ComplaintRecord[] = [];
  let added = 0, skipped = 0;

  for (const inc of incidents) {
    const rentalId = (inc.rentalId || "").trim();
    const iso = inc.date;
    const parts = periodOf(iso);
    if (!parts || (inc.category !== "lot_full" && inc.category !== "inaccessibility")) { skipped++; continue; }
    if (rentalId) {
      if (ids.has(rentalId)) { skipped++; continue; }
      ids.add(rentalId);
    } else {
      const sig = `${inc.facility}|${iso}|${inc.category}`;
      if (blankSigs.has(sig)) { skipped++; continue; }
      blankSigs.add(sig);
    }
    newRecords.push({
      rentalId,
      facilityName: inc.facility,
      facilityId: resolveFacilityId(dir, inc.facility),
      complaintType: inc.category,
      complaintDate: iso,
      source: "SpotHero",
      resolutionStatus: "Open",
      notes: "",
      uploadDate: now,
      reportingYear: parts.year,
      reportingMonth: parts.month,
      reportingBiweekly: parts.biweekly,
    });
    added++;
  }

  const log: UploadLog = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    fileName: body.fileName || "upload.csv",
    uploadDate: now,
    uploadedBy: body.uploadedBy || "Unknown",
    totalRecords: incidents.length,
    newRecordsAdded: added,
    duplicateRecordsSkipped: skipped,
  };

  try {
    await appendComplaints(newRecords, log.uploadedBy, log.fileName);
    await appendUpload(log);
  } catch (e) {
    return Response.json(
      { error: "store_failed", description: e instanceof Error ? e.message : "could not store to Supabase" },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, log });
}
