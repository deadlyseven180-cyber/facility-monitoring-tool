import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import type { FacilityNote } from "@/lib/complaints/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(CACHE_DIR, "facility-notes.json");

async function readAll(): Promise<FacilityNote[]> {
  try {
    const p = JSON.parse(await readFile(FILE, "utf8"));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
async function writeAll(rows: FacilityNote[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(rows), "utf8");
}

export async function GET() {
  return Response.json({ ok: true, notes: await readAll() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<FacilityNote>;
  if (!b.facilityName?.trim() || !b.note?.trim())
    return Response.json({ error: "facility_and_note_required" }, { status: 400 });
  const note: FacilityNote = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    facilityKey: b.facilityKey || "",
    facilityName: b.facilityName.trim(),
    category: b.category || "Action Taken",
    note: b.note.trim(),
    author: b.author || "Unknown",
    dateCreated: b.dateCreated || new Date().toISOString().slice(0, 10),
    dateImplemented: b.dateImplemented || "",
  };
  const rows = await readAll();
  rows.unshift(note);
  await writeAll(rows);
  return Response.json({ ok: true, note });
}

export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<FacilityNote> & { id?: string };
  if (!b.id) return Response.json({ error: "id_required" }, { status: 400 });
  const rows = await readAll();
  const i = rows.findIndex((r) => r.id === b.id);
  if (i === -1) return Response.json({ error: "not_found" }, { status: 404 });
  rows[i] = {
    ...rows[i],
    category: b.category !== undefined ? b.category : rows[i].category,
    note: b.note !== undefined ? b.note.trim() : rows[i].note,
    dateImplemented: b.dateImplemented !== undefined ? b.dateImplemented : rows[i].dateImplemented,
  };
  await writeAll(rows);
  return Response.json({ ok: true, note: rows[i] });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id_required" }, { status: 400 });
  await writeAll((await readAll()).filter((r) => r.id !== id));
  return Response.json({ ok: true });
}
