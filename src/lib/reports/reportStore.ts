// Durable storage for shared/exported reports in Supabase (public `reports`
// table). This lets a shared report link keep working even when the machine
// that generated it is off — the report lives in Supabase and is served by the
// always-on Render deployment.

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";

/** True when Supabase-backed report storage is configured. */
export function reportsConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/** Save (upsert) a report's HTML under an id. Throws on failure. */
export async function saveReport(id: string, html: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      // Upsert so re-sharing the same id overwrites rather than 409s.
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ id, html }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase report save ${res.status}: ${await res.text()}`);
  }
}

/** Read a report's HTML by id, or null if not found / on error. */
export async function getReport(id: string): Promise<string | null> {
  const url = `${SUPABASE_URL}/rest/v1/reports?id=eq.${encodeURIComponent(id)}&select=html&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { html?: string }[];
  return rows[0]?.html ?? null;
}
