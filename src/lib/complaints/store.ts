// Storage for the SpotHero complaint history + upload log — backed by a Supabase
// (Postgres) database so uploads persist permanently and auto-load on every
// device/deploy, independent of any one computer.
//   • public.spothero_complaints  — one row per complaint
//   • public.spothero_upload_log  — one row per upload
// Accessed server-side via the PostgREST API using the service-role key
// (SUPABASE_URL + SUPABASE_SERVICE_KEY env vars). Internal complaints are NOT
// stored here (they stay live from Refunds & Reimbursements via internal.ts).

import type { ComplaintRecord, HistoryStore, UploadLog } from "./types";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const COMPLAINTS = "spothero_complaints";
const UPLOADS = "spothero_upload_log";

function configured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}
function headers(extra?: Record<string, string>): Record<string, string> {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", ...(extra || {}) };
}
function s(v: unknown): string {
  return v == null ? "" : String(v);
}

/** Read every row from a table (paginated). */
async function selectAll(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const lim = 1000;
  let offset = 0;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc&limit=${lim}&offset=${offset}`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const batch = (await res.json()) as Record<string, unknown>[];
    out.push(...batch);
    if (batch.length < lim) break;
    offset += lim;
  }
  return out;
}

/** Insert rows in batches. */
async function insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Supabase insert ${res.status}: ${await res.text()}`);
  }
}

/** Load all stored SpotHero complaints + the upload log. */
export async function readStore(): Promise<HistoryStore> {
  if (!configured()) return { complaints: [], uploads: [] };
  const [crows, urows] = await Promise.all([selectAll(COMPLAINTS), selectAll(UPLOADS)]);

  const complaints: ComplaintRecord[] = crows.map((r) => ({
    rentalId: s(r.rental_id),
    facilityName: s(r.facility_name),
    facilityId: s(r.facility_id),
    complaintType: s(r.complaint_type) === "lot_full" ? "lot_full" : "inaccessibility",
    complaintDate: s(r.complaint_date),
    source: "SpotHero",
    resolutionStatus: s(r.resolution_status) || "Open",
    notes: "",
    uploadDate: s(r.upload_date),
    reportingYear: Number(r.reporting_year) || 0,
    reportingMonth: Number(r.reporting_month) || 0,
    reportingBiweekly: Number(r.reporting_biweekly) === 2 ? 2 : 1,
  }));

  const uploads: UploadLog[] = urows
    .map((r) => ({
      id: s(r.id),
      fileName: s(r.file_name),
      uploadDate: s(r.upload_date),
      uploadedBy: s(r.uploaded_by),
      totalRecords: Number(r.total_records) || 0,
      newRecordsAdded: Number(r.new_records_added) || 0,
      duplicateRecordsSkipped: Number(r.duplicates_skipped) || 0,
    }))
    .sort((a, b) => (b.uploadDate || "").localeCompare(a.uploadDate || ""));

  return { complaints, uploads };
}

/** Append newly-uploaded SpotHero complaints. */
export async function appendComplaints(records: ComplaintRecord[], uploadedBy: string, fileName: string): Promise<void> {
  if (records.length === 0) return;
  if (!configured()) throw new Error("Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).");
  const rows = records.map((r) => ({
    rental_id: r.rentalId || "",
    facility_name: r.facilityName,
    facility_id: r.facilityId || "",
    complaint_type: r.complaintType,
    complaint_date: r.complaintDate || null,
    source: "SpotHero",
    resolution_status: r.resolutionStatus || "Open",
    uploaded_by: uploadedBy || "",
    file_name: fileName || "",
    upload_date: r.uploadDate,
    reporting_year: r.reportingYear,
    reporting_month: r.reportingMonth,
    reporting_biweekly: r.reportingBiweekly,
  }));
  await insert(COMPLAINTS, rows);
}

/** Record one upload in the upload-log table. */
export async function appendUpload(log: UploadLog): Promise<void> {
  if (!configured()) throw new Error("Supabase not configured.");
  await insert(UPLOADS, [
    {
      file_name: log.fileName,
      upload_date: log.uploadDate,
      uploaded_by: log.uploadedBy,
      total_records: log.totalRecords,
      new_records_added: log.newRecordsAdded,
      duplicates_skipped: log.duplicateRecordsSkipped,
    },
  ]);
}
