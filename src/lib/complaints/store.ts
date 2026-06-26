// Storage for the SpotHero complaint history + upload log — backed by a Google
// Sheet in the user's Google Drive, via a Google Apps Script Web App that runs
// as the user (so it has Drive access without the app holding Google creds).
//   • "Complaints" tab  — one row per complaint
//   • "UploadLog" tab   — one row per upload
// Configured with GSHEET_WEBAPP_URL (+ optional GSHEET_TOKEN shared secret).
// Internal complaints are NOT stored here (they stay live from Refunds &
// Reimbursements via internal.ts).

import type { ComplaintRecord, HistoryStore, UploadLog } from "./types";

const WEBAPP_URL = process.env.GSHEET_WEBAPP_URL || "";
const TOKEN = process.env.GSHEET_TOKEN || "";

function configured(): boolean {
  return Boolean(WEBAPP_URL);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function s(v: unknown): string {
  return v == null ? "" : String(v);
}

async function callGet(): Promise<{ complaints: unknown[]; uploads: unknown[] }> {
  const url = new URL(WEBAPP_URL);
  if (TOKEN) url.searchParams.set("token", TOKEN);
  const res = await fetch(url.toString(), { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`Google Sheet read ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { ok?: boolean; error?: string; complaints?: unknown[]; uploads?: unknown[] };
  if (j.ok === false) throw new Error(j.error || "sheet read failed");
  return { complaints: Array.isArray(j.complaints) ? j.complaints : [], uploads: Array.isArray(j.uploads) ? j.uploads : [] };
}

async function callPost(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, ...payload }),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Google Sheet write ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json().catch(() => ({ ok: false, error: "non-JSON response" }))) as { ok?: boolean; error?: string };
  if (!j.ok) throw new Error(j.error || "sheet write failed");
}

/** Load all stored SpotHero complaints + the upload log from the Google Sheet. */
export async function readStore(): Promise<HistoryStore> {
  if (!configured()) return { complaints: [], uploads: [] };
  const data = await callGet();

  const complaints: ComplaintRecord[] = (data.complaints as Record<string, unknown>[]).map((r) => ({
    rentalId: s(r.rentalId),
    facilityName: s(r.facilityName),
    facilityId: s(r.facilityId),
    complaintType: s(r.complaintType) === "lot_full" ? "lot_full" : "inaccessibility",
    complaintDate: s(r.complaintDate),
    source: "SpotHero",
    resolutionStatus: s(r.resolutionStatus) || "Open",
    notes: "",
    uploadDate: s(r.uploadDate),
    reportingYear: num(r.reportingYear),
    reportingMonth: num(r.reportingMonth),
    reportingBiweekly: num(r.reportingBiweekly) === 2 ? 2 : 1,
  }));

  const uploads: UploadLog[] = (data.uploads as Record<string, unknown>[])
    .map((r) => ({
      id: s(r.id),
      fileName: s(r.fileName),
      uploadDate: s(r.uploadDate),
      uploadedBy: s(r.uploadedBy),
      totalRecords: num(r.totalRecords),
      newRecordsAdded: num(r.newRecordsAdded),
      duplicateRecordsSkipped: num(r.duplicateRecordsSkipped),
    }))
    .sort((a, b) => (b.uploadDate || "").localeCompare(a.uploadDate || ""));

  return { complaints, uploads };
}

/** Append newly-uploaded SpotHero complaints to the Google Sheet. */
export async function appendComplaints(records: ComplaintRecord[], uploadedBy: string, fileName: string): Promise<void> {
  if (records.length === 0) return;
  if (!configured()) throw new Error("Google Sheet not configured (set GSHEET_WEBAPP_URL).");
  const rows = records.map((r) => ({
    rentalId: r.rentalId || "",
    facilityName: r.facilityName,
    facilityId: r.facilityId || "",
    complaintType: r.complaintType,
    complaintDate: r.complaintDate || "",
    source: "SpotHero",
    resolutionStatus: r.resolutionStatus || "Open",
    uploadDate: r.uploadDate,
    reportingYear: r.reportingYear,
    reportingMonth: r.reportingMonth,
    reportingBiweekly: r.reportingBiweekly,
    uploadedBy: uploadedBy || "",
    fileName: fileName || "",
  }));
  await callPost({ type: "complaints", rows });
}

/** Record one upload in the upload-log tab. */
export async function appendUpload(log: UploadLog): Promise<void> {
  if (!configured()) throw new Error("Google Sheet not configured (set GSHEET_WEBAPP_URL).");
  await callPost({ type: "upload", row: log });
}
