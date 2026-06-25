import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(CACHE_DIR, "investigations.json");

export interface Investigation {
  id: string;
  dateCreated: string;
  facilityName: string;
  title: string;
  rentalId: string;
  status: string; // Open | In Progress | Resolved
  notes: string;
  author: string;
}

async function readAll(): Promise<Investigation[]> {
  try {
    const p = JSON.parse(await readFile(FILE, "utf8"));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
async function writeAll(rows: Investigation[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(rows), "utf8");
}

export async function GET() {
  return Response.json({ ok: true, investigations: await readAll() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<Investigation>;
  if (!b.title?.trim()) return Response.json({ error: "title_required" }, { status: 400 });
  const row: Investigation = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    dateCreated: new Date().toISOString().slice(0, 10),
    facilityName: b.facilityName || "",
    title: b.title.trim(),
    rentalId: b.rentalId || "",
    status: b.status || "Open",
    notes: b.notes || "",
    author: b.author || "Unknown",
  };
  const rows = await readAll();
  rows.unshift(row);
  await writeAll(rows);
  return Response.json({ ok: true, investigation: row });
}

export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<Investigation> & { id?: string };
  if (!b.id) return Response.json({ error: "id_required" }, { status: 400 });
  const rows = await readAll();
  const i = rows.findIndex((r) => r.id === b.id);
  if (i === -1) return Response.json({ error: "not_found" }, { status: 404 });
  rows[i] = {
    ...rows[i],
    status: b.status !== undefined ? b.status : rows[i].status,
    notes: b.notes !== undefined ? b.notes : rows[i].notes,
    title: b.title !== undefined ? b.title.trim() : rows[i].title,
  };
  await writeAll(rows);
  return Response.json({ ok: true, investigation: rows[i] });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id_required" }, { status: 400 });
  await writeAll((await readAll()).filter((r) => r.id !== id));
  return Response.json({ ok: true });
}
