import {
  credsFrom,
  persistStores,
  reservationMs,
  syncAll,
  type Reservation,
} from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(r: any): Reservation {
  return {
    msgId: String(r.msgId ?? r.reservationId ?? ""),
    reservationId: String(r.reservationId ?? ""),
    facility: String(r.facility ?? ""),
    bookingDate: String(r.bookingDate ?? ""),
    start: String(r.start ?? ""),
    end: String(r.end ?? ""),
    startMs: r.startMs ?? reservationMs(r.start ?? ""),
    endMs: r.endMs ?? reservationMs(r.end ?? ""),
  };
}

/** Load the two databases — from an Apps Script Web App URL if provided,
 *  otherwise by polling Gmail directly with OAuth credentials. */
export async function GET(req: Request) {
  // Preferred: a Google Apps Script Web App that already gathered the emails.
  const appsUrl = req.headers.get("x-appsscript-url");
  if (appsUrl) {
    try {
      const res = await fetch(appsUrl, { cache: "no-store", redirect: "follow" });
      if (!res.ok) throw new Error(`Apps Script returned ${res.status}.`);
      const d = (await res.json()) as {
        error?: string;
        updatedAt?: string;
        parkers?: unknown[];
        cancelled?: unknown[];
      };
      if (d.error) throw new Error(d.error);
      const parkers = (d.parkers ?? []).map(normalize);
      const cancelled = (d.cancelled ?? []).map(normalize);
      // Persist so the Overbook Checker can read SH Daily Parkers as transient.
      await persistStores(parkers, cancelled);
      return Response.json({
        connected: true,
        updatedAt: d.updatedAt ?? new Date().toISOString(),
        parkers,
        cancelled,
      });
    } catch (e) {
      return Response.json(
        {
          connected: false,
          error: e instanceof Error ? e.message : "Apps Script fetch failed.",
        },
        { status: 502 },
      );
    }
  }

  // Fallback: direct Gmail API polling.
  const creds = credsFrom(req);
  if (!creds) {
    return Response.json({
      connected: false,
      error: "Connect Gmail to load SH Daily Parkers and Cancelled Bookings.",
    });
  }
  try {
    const data = await syncAll(creds);
    return Response.json({ connected: true, ...data });
  } catch (e) {
    return Response.json(
      {
        connected: false,
        error: e instanceof Error ? e.message : "Gmail sync failed.",
      },
      { status: 502 },
    );
  }
}
