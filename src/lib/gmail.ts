// Server-side Gmail ingestion for SpotHero "SH Daily Parkers" (confirmations)
// and "Cancelled Bookings". Uses an OAuth2 refresh token (user-supplied) to
// poll the two labels, parse each reservation, and persist a 60-day window to
// JSON "databases" under .data/.

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export interface GmailCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface Reservation {
  msgId: string;
  reservationId: string;
  facility: string;
  /** When the confirmation/cancellation email arrived (ISO). */
  bookingDate: string;
  /** Raw reservation start/end text from the email. */
  start: string;
  end: string;
  startMs: number | null;
  endMs: number | null;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const WINDOW_DAYS = 60;
const DAY = 86_400_000;

/** Gmail label IDs for the two feeds. */
export const LABELS = {
  dailyParkers: "Label_2174397382270109406", // SH Daily Parkers
  cancelled: "Label_1357216592169916268", // SH Daily Parkers/Cancelled Bookings
};

export const STORE_FILES = {
  dailyParkers: "daily-parkers.json",
  cancelled: "cancelled-bookings.json",
};

/** Pull credentials from request headers, falling back to env vars. */
export function credsFrom(req: Request): GmailCreds | null {
  const clientId =
    req.headers.get("x-gmail-client-id") || process.env.GMAIL_CLIENT_ID || "";
  const clientSecret =
    req.headers.get("x-gmail-client-secret") ||
    process.env.GMAIL_CLIENT_SECRET ||
    "";
  const refreshToken =
    req.headers.get("x-gmail-refresh-token") ||
    process.env.GMAIL_REFRESH_TOKEN ||
    "";
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

async function accessToken(c: GmailCreds): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail auth failed (${res.status}). Check your credentials.`);
  }
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("Gmail auth returned no access token.");
  return j.access_token;
}

async function listIds(
  token: string,
  labelId: string,
  query: string,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${GMAIL}/messages`);
    url.searchParams.set("labelIds", labelId);
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Gmail list failed (${res.status}).`);
    const j = (await res.json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    for (const m of j.messages ?? []) ids.push(m.id);
    pageToken = j.nextPageToken;
  } while (pageToken && ids.length < 1000);
  return ids;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeBody(payload: any): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (p: any): string | null => {
    if (!p) return null;
    if (p.mimeType === "text/plain" && p.body?.data) return p.body.data;
    if (p.parts) for (const c of p.parts) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  let data = walk(payload);
  if (!data && payload?.body?.data) data = payload.body.data;
  if (!data) return "";
  return Buffer.from(
    String(data).replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

function stripWeekday(s: string): string {
  return s.replace(/^\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s*/i, "").trim();
}

/** Parse a SpotHero confirmation / cancellation email body into a Reservation. */
export function parseReservation(
  msgId: string,
  internalDateMs: number,
  body: string,
): Reservation | null {
  const clean = body
    .replace(/\*/g, "")
    .replace(/ /g, " ")
    .replace(/\r/g, " ");
  const id = clean.match(/Rental ID#?:\s*(\d+)/i);
  if (!id) return null;
  const fac = clean.match(
    /reservation for\s+([\s\S]+?)\s+(?:is confirmed|has been cancel)/i,
  );
  const start = clean.match(
    /Reservation Start:\s*([^\n*<]+?)(?:\s{2,}|\n|Reservation End|License|Rate|Phone|Total|$)/i,
  );
  const end = clean.match(
    /Reservation End:\s*([^\n*<]+?)(?:\s{2,}|\n|License|Rate|Phone|Total|$)/i,
  );
  const startRaw = start ? start[1].trim() : "";
  const endRaw = end ? end[1].trim() : "";
  const sMs = Date.parse(stripWeekday(startRaw));
  const eMs = Date.parse(stripWeekday(endRaw));
  return {
    msgId,
    reservationId: id[1],
    facility: fac ? fac[1].replace(/\s+/g, " ").trim() : "",
    bookingDate: new Date(internalDateMs).toISOString(),
    start: startRaw,
    end: endRaw,
    startMs: Number.isNaN(sMs) ? null : sMs,
    endMs: Number.isNaN(eMs) ? null : eMs,
  };
}

async function getMessage(
  token: string,
  id: string,
): Promise<{ internalDate: number; body: string } | null> {
  const res = await fetch(`${GMAIL}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { internalDate?: string; payload?: unknown };
  return {
    internalDate: Number(j.internalDate ?? Date.now()),
    body: decodeBody(j.payload),
  };
}

const DIR = path.join(process.cwd(), ".data");

async function load(file: string): Promise<Reservation[]> {
  try {
    return JSON.parse(await readFile(path.join(DIR, file), "utf8"));
  } catch {
    return [];
  }
}

async function persist(file: string, recs: Reservation[]): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, file), JSON.stringify(recs), "utf8");
}

/** Parse a reservation date string (e.g. "Mon June 15, 2026 8:00 AM") to ms. */
export function reservationMs(text: string): number | null {
  const v = Date.parse(stripWeekday(String(text ?? "")));
  return Number.isNaN(v) ? null : v;
}

/** Write both databases to .data (used by the Apps Script ingestion path). */
export async function persistStores(
  parkers: Reservation[],
  cancelled: Reservation[],
): Promise<void> {
  await persist(STORE_FILES.dailyParkers, parkers);
  await persist(STORE_FILES.cancelled, cancelled);
}

/** Keep reservations relevant to the next 60 days (drop long-past ones). */
function withinWindow(r: Reservation, now: number): boolean {
  if (r.endMs == null && r.startMs == null) return true;
  const lo = now - DAY; // keep through end of yesterday
  const hi = now + WINDOW_DAYS * DAY;
  const e = r.endMs ?? (r.startMs as number);
  const s = r.startMs ?? (r.endMs as number);
  return e >= lo && s <= hi;
}

async function syncLabel(
  token: string,
  labelId: string,
  file: string,
  now: number,
): Promise<Reservation[]> {
  const existing = await load(file);
  const seen = new Set(existing.map((r) => r.msgId));
  const ids = await listIds(token, labelId, `newer_than:${WINDOW_DAYS}d`);
  const fresh: Reservation[] = [];
  for (const id of ids.filter((x) => !seen.has(x)).slice(0, 400)) {
    const m = await getMessage(token, id);
    if (!m) continue;
    const r = parseReservation(id, m.internalDate, m.body);
    if (r) fresh.push(r);
  }
  // Merge, dedupe by reservation ID (latest email wins), keep 60-day window.
  const byRes = new Map<string, Reservation>();
  for (const r of [...existing, ...fresh]) {
    const prev = byRes.get(r.reservationId);
    if (!prev || r.bookingDate > prev.bookingDate) byRes.set(r.reservationId, r);
  }
  const merged = [...byRes.values()]
    .filter((r) => withinWindow(r, now))
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  await persist(file, merged);
  return merged;
}

/** Poll both labels and return the refreshed databases. */
export async function syncAll(creds: GmailCreds): Promise<{
  updatedAt: string;
  parkers: Reservation[];
  cancelled: Reservation[];
}> {
  const token = await accessToken(creds);
  const now = Date.now();
  const [parkers, cancelled] = await Promise.all([
    syncLabel(token, LABELS.dailyParkers, STORE_FILES.dailyParkers, now),
    syncLabel(token, LABELS.cancelled, STORE_FILES.cancelled, now),
  ]);
  return { updatedAt: new Date(now).toISOString(), parkers, cancelled };
}
