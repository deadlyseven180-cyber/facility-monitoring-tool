// Storage for the SpotHero complaint history + upload log — backed by Airtable
// so uploads persist permanently and auto-load on every device/deploy.
//   • "SpotHero Complaints"  (tblVtwE3dRIR0d0kr) — one row per complaint
//   • "SpotHero Upload Log"  (tblIkWbgDbb2z6iuI) — one row per upload
// Internal complaints are NOT stored here (they stay live from Refunds &
// Reimbursements via internal.ts).

import type { ComplaintRecord, HistoryStore, UploadLog } from "./types";

const BASE_ID = "app9iYUN8J3z2wjXN";
const COMPLAINTS_TABLE = "tblVtwE3dRIR0d0kr";
const UPLOADS_TABLE = "tblIkWbgDbb2z6iuI";

interface AtRecord { id: string; fields: Record<string, unknown> }

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && "name" in (v as object)) return String((v as { name: string }).name);
  return String(v);
}

/** Read every record from a table (paginated). */
async function atList(pat: string, table: string, fields: string[]): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${table}`);
    url.searchParams.set("pageSize", "100");
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

/** Create records in batches of 10 (Airtable's per-request limit). */
async function atCreate(pat: string, table: string, rows: { fields: Record<string, unknown> }[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${table}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch, typecast: true }),
    });
    if (!res.ok) throw new Error(`Airtable create ${res.status}: ${await res.text()}`);
  }
}

const COMPLAINT_FIELDS = [
  "Rental ID", "Facility Name", "Facility ID", "Complaint Type", "Complaint Date",
  "Source", "Resolution Status", "Upload Date", "Reporting Year", "Reporting Month", "Reporting Biweekly",
];
const UPLOAD_FIELDS = ["File Name", "Upload Date", "Uploaded By", "Total Records", "New Records Added", "Duplicates Skipped"];

/** Load all stored SpotHero complaints + the upload log from Airtable. */
export async function readStore(pat: string): Promise<HistoryStore> {
  if (!pat) return { complaints: [], uploads: [] };
  const [crecs, urecs] = await Promise.all([
    atList(pat, COMPLAINTS_TABLE, COMPLAINT_FIELDS),
    atList(pat, UPLOADS_TABLE, UPLOAD_FIELDS),
  ]);

  const complaints: ComplaintRecord[] = crecs.map((r) => {
    const f = r.fields;
    return {
      rentalId: str(f["Rental ID"]),
      facilityName: str(f["Facility Name"]),
      facilityId: str(f["Facility ID"]),
      complaintType: str(f["Complaint Type"]) === "Lot Full" ? "lot_full" : "inaccessibility",
      complaintDate: str(f["Complaint Date"]),
      source: "SpotHero",
      resolutionStatus: str(f["Resolution Status"]) || "Open",
      notes: "",
      uploadDate: str(f["Upload Date"]),
      reportingYear: Number(f["Reporting Year"]) || 0,
      reportingMonth: Number(f["Reporting Month"]) || 0,
      reportingBiweekly: Number(f["Reporting Biweekly"]) === 2 ? 2 : 1,
    };
  });

  const uploads: UploadLog[] = urecs
    .map((r) => {
      const f = r.fields;
      return {
        id: r.id,
        fileName: str(f["File Name"]),
        uploadDate: str(f["Upload Date"]),
        uploadedBy: str(f["Uploaded By"]),
        totalRecords: Number(f["Total Records"]) || 0,
        newRecordsAdded: Number(f["New Records Added"]) || 0,
        duplicateRecordsSkipped: Number(f["Duplicates Skipped"]) || 0,
      };
    })
    .sort((a, b) => (b.uploadDate || "").localeCompare(a.uploadDate || ""));

  return { complaints, uploads };
}

/** Append newly-uploaded SpotHero complaints to Airtable. */
export async function appendComplaints(
  pat: string,
  records: ComplaintRecord[],
  uploadedBy: string,
  fileName: string,
): Promise<void> {
  if (!pat || records.length === 0) return;
  const rows = records.map((r) => ({
    fields: {
      "Rental ID": r.rentalId || "",
      "Facility Name": r.facilityName,
      "Facility ID": r.facilityId || "",
      "Complaint Type": r.complaintType === "lot_full" ? "Lot Full" : "Inaccessibility",
      "Complaint Date": r.complaintDate,
      "Source": "SpotHero",
      "Resolution Status": r.resolutionStatus || "Open",
      "Uploaded By": uploadedBy || "",
      "File Name": fileName || "",
      "Upload Date": r.uploadDate,
      "Reporting Year": r.reportingYear,
      "Reporting Month": r.reportingMonth,
      "Reporting Biweekly": r.reportingBiweekly,
    },
  }));
  await atCreate(pat, COMPLAINTS_TABLE, rows);
}

/** Record one upload in the upload-log table. */
export async function appendUpload(pat: string, log: UploadLog): Promise<void> {
  if (!pat) return;
  await atCreate(pat, UPLOADS_TABLE, [
    {
      fields: {
        "File Name": log.fileName,
        "Upload Date": log.uploadDate,
        "Uploaded By": log.uploadedBy,
        "Total Records": log.totalRecords,
        "New Records Added": log.newRecordsAdded,
        "Duplicates Skipped": log.duplicateRecordsSkipped,
      },
    },
  ]);
}
