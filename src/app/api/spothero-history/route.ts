import { readFacilityFinancials } from "@/lib/complaints/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stored per-facility financials (net remit, refunds, reservations, complaints)
 *  for the in-tool History view — read back without re-uploading a CSV. */
export async function GET() {
  try {
    const financials = await readFacilityFinancials();
    return Response.json({ ok: true, financials });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "could not read history" },
      { status: 502 },
    );
  }
}
