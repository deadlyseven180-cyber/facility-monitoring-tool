import { gatherInternal, getDirectory } from "@/lib/complaints/internal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live internal Lot Full / Inaccessibility complaints from Airtable. Thin
 * wrapper over the shared `gatherInternal` so the Gather Data report and the
 * Facility Progress Checker always return the SAME deduped internal data.
 *   ?category=all|lot_full|inaccessibility
 */
export async function GET(req: Request) {
  const pat = req.headers.get("x-airtable-pat") || process.env.AIRTABLE_PAT || "";
  const category = new URL(req.url).searchParams.get("category") || "all";
  if (!["all", "lot_full", "inaccessibility"].includes(category))
    return Response.json({ error: "bad_category" }, { status: 400 });
  if (!pat)
    return Response.json(
      { error: "missing_pat", description: "Airtable PAT required (x-airtable-pat header)." },
      { status: 400 },
    );

  try {
    const dir = await getDirectory(pat).catch(() => ({}));
    const all = await gatherInternal(pat, dir);
    const recs = category === "all" ? all : all.filter((r) => r.category === category);
    const records = recs.map((r) => ({
      rentalId: r.rentalId,
      date: r.date,
      facility: r.facility,
      reason: r.reason,
      category: r.category,
      source: r.source,
      state: r.state,
      amount: r.amount,
      origins: r.origins,
    }));
    return Response.json({
      ok: true,
      category,
      counts: {
        total: records.length,
        lotFull: records.filter((r) => r.category === "lot_full").length,
        inaccessibility: records.filter((r) => r.category === "inaccessibility").length,
      },
      records,
    });
  } catch (e) {
    return Response.json(
      { error: "fetch_failed", description: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
