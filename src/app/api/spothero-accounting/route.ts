import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM =
  "https://services.production.spothero.com/control-panel-service/v1/accounting/summary/";

/**
 * Server-side proxy for the SpotHero Control Panel Accounting API.
 *
 * The browser can't safely hold the long-lived token and the upstream wants a
 * Bearer JWT, so the dashboard sends the token here (header `x-spothero-token`,
 * stored in localStorage like the Airtable PAT) and we forward it as
 * `Authorization: Bearer <token>`.
 *
 * Query params are passed straight through:
 *   ?facility_ids=81099,130666&from_date=2026-05-01&to_date=2026-05-31
 *
 * Returns the upstream JSON untouched (with its status), or a 400 if no token
 * was supplied. Once we see a real response we can map its fields into the
 * Gather Data report.
 */
export async function GET(req: NextRequest) {
  const token =
    req.headers.get("x-spothero-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    process.env.SPOTHERO_TOKEN ||
    "";

  if (!token) {
    return Response.json(
      {
        error: "missing_token",
        description:
          "Provide your SpotHero control-panel Bearer token via the 'x-spothero-token' header.",
      },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const facilityIds = searchParams.get("facility_ids") ?? "";
  const fromDate = searchParams.get("from_date") ?? "";
  const toDate = searchParams.get("to_date") ?? "";

  const url = new URL(UPSTREAM);
  if (facilityIds) url.searchParams.set("facility_ids", facilityIds);
  if (fromDate) url.searchParams.set("from_date", fromDate);
  if (toDate) url.searchParams.set("to_date", toDate);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    // Forward the upstream status so the UI can tell auth errors from data.
    return Response.json(
      { ok: res.ok, status: res.status, data: body },
      { status: res.ok ? 200 : res.status },
    );
  } catch (e) {
    return Response.json(
      { error: "fetch_failed", description: e instanceof Error ? e.message : "request failed" },
      { status: 502 },
    );
  }
}
