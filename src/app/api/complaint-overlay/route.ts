import { readOverlay, writeOverlay, type Overlay } from "@/lib/complaints/overlay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, overlay: await readOverlay() });
}

/** Set/merge the overlay (root cause + resolution) for one complaint key. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { key?: string } & Overlay;
  if (!b.key) return Response.json({ error: "key_required" }, { status: 400 });
  const map = await readOverlay();
  const prev = map[b.key] ?? {};
  map[b.key] = {
    rootCause: b.rootCause !== undefined ? b.rootCause : prev.rootCause,
    resolutionStatus: b.resolutionStatus !== undefined ? b.resolutionStatus : prev.resolutionStatus,
    resolutionDate: b.resolutionDate !== undefined ? b.resolutionDate : prev.resolutionDate,
  };
  await writeOverlay(map);
  return Response.json({ ok: true, overlay: map[b.key] });
}
