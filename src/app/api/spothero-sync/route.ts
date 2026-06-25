import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { stateFromAddress } from "@/lib/reports/facilityKey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_ID = "app9iYUN8J3z2wjXN";
const FACILITY_TABLE = "tblmun9KBYW4aYBe1";
const SUMMARY =
  "https://services.production.spothero.com/control-panel-service/v1/accounting/summary/";
const CACHE_DIR = path.join(process.cwd(), ".data");
const INDEX_FILE = path.join(CACHE_DIR, "facility-index.json");
const MARKETS = ["MA", "IL", "DC"];

interface AtRec {
  id: string;
  fields: Record<string, unknown>;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && "name" in (v as object))
    return String((v as { name: string }).name);
  return String(v);
}

/** Fetch every facility's ID + address from Airtable (paginated). */
async function fetchFacilities(pat: string): Promise<AtRec[]> {
  const out: AtRec[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${FACILITY_TABLE}`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.append("fields[]", "FACILITY ID");
    url.searchParams.append("fields[]", "FACILITY ADDRESS");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = (await res.json()) as { records: AtRec[]; offset?: string };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

/** Build a state → [SpotHero facility ID] index from the facility addresses. */
function buildIndex(records: AtRec[]): Record<string, string[]> {
  const idx: Record<string, Set<string>> = {};
  for (const r of records) {
    const id = str(r.fields["FACILITY ID"]).trim();
    const st = stateFromAddress(str(r.fields["FACILITY ADDRESS"]));
    if (!id || !st) continue;
    (idx[st] ??= new Set()).add(id);
  }
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(idx)) out[k] = [...idx[k]];
  return out;
}

async function getIndex(pat: string): Promise<Record<string, string[]>> {
  try {
    const c = JSON.parse(await readFile(INDEX_FILE, "utf8"));
    if (c && Object.keys(c).length) return c;
  } catch {
    /* no cache yet */
  }
  if (!pat) return {};
  const recs = await fetchFacilities(pat);
  const index = buildIndex(recs);
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(INDEX_FILE, JSON.stringify(index), "utf8");
  } catch {
    /* best-effort cache */
  }
  return index;
}

const ACC_KEYS = [
  "gross_sales",
  "net_revenue",
  "net_revenue_after_adj",
  "net_revenue_after_adj_and_tax",
  "remit_before_adj",
  "refunds",
  "refund_count",
  "reservation_count",
] as const;
type Bucket = Record<(typeof ACC_KEYS)[number], number>;
const zero = (): Bucket =>
  Object.fromEntries(ACC_KEYS.map((k) => [k, 0])) as Bucket;
const chunk = <T,>(a: T[], n: number): T[][] =>
  a.reduce<T[][]>((o, _, i) => (i % n ? o : o.concat([a.slice(i, i + n)])), []);

/** Sum a state's facilities through the SpotHero summary API (batched). */
async function sumState(
  token: string,
  ids: string[],
  from: string,
  to: string,
): Promise<{ buckets: Record<string, Bucket>; expired: boolean }> {
  const buckets = { monthly: zero(), transient: zero(), total: zero() };
  let expired = false;
  for (const grp of chunk(ids, 20)) {
    const url = `${SUMMARY}?to_date=${to}&from_date=${from}&facility_ids=${grp.join(",")}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (r.status === 401) {
      expired = true;
      break;
    }
    if (!r.ok) continue;
    const j = (await r.json()) as { data?: Record<string, Bucket> };
    for (const b of ["monthly", "transient", "total"] as const) {
      const t = j?.data?.[b];
      if (!t) continue;
      for (const k of ACC_KEYS) buckets[b][k] += Number(t[k]) || 0;
    }
  }
  return { buckets, expired };
}

/**
 * On-demand "Sync now" for live SpotHero accounting. Aggregates the accounting
 * summary by state for a date range, using the user's Bearer token (header
 * `x-spothero-token`) and the Airtable PAT (`x-airtable-pat`, to build/cache the
 * facility→state index). Amounts come back in cents.
 *   ?state=All|MA|IL|DC&from_date=2026-05-01&to_date=2026-05-31
 */
export async function GET(req: Request) {
  const token =
    req.headers.get("x-spothero-token") || process.env.SPOTHERO_TOKEN || "";
  const pat = req.headers.get("x-airtable-pat") || process.env.AIRTABLE_PAT || "";
  const sp = new URL(req.url).searchParams;
  const state = sp.get("state") || "All";
  const from = sp.get("from_date") || "";
  const to = sp.get("to_date") || "";

  if (!token)
    return Response.json(
      { error: "missing_token", description: "Paste your SpotHero control-panel Bearer token." },
      { status: 400 },
    );
  if (!from || !to)
    return Response.json({ error: "missing_dates" }, { status: 400 });

  let index: Record<string, string[]>;
  try {
    index = await getIndex(pat);
  } catch {
    index = {};
  }
  if (!Object.keys(index).length)
    return Response.json(
      {
        error: "no_facility_index",
        description:
          "Couldn't build the facility list — open this once with your Airtable PAT available so it can cache the facility→state index.",
      },
      { status: 400 },
    );

  const states =
    state === "All" ? MARKETS.filter((s) => index[s]?.length) : [state];
  type StateRow = {
    state: string;
    facilities: number;
    monthly: Bucket;
    transient: Bucket;
    total: Bucket;
  };
  const out: StateRow[] = [];
  const grand = { monthly: zero(), transient: zero(), total: zero() };

  for (const st of states) {
    const ids = index[st] || [];
    const { buckets, expired } = await sumState(token, ids, from, to);
    if (expired)
      return Response.json(
        { error: "token_expired", description: "Your SpotHero token has expired — paste a fresh one." },
        { status: 401 },
      );
    out.push({
      state: st,
      facilities: ids.length,
      monthly: buckets.monthly,
      transient: buckets.transient,
      total: buckets.total,
    });
    for (const b of ["monthly", "transient", "total"] as const)
      for (const k of ACC_KEYS) grand[b][k] += buckets[b][k];
  }

  return Response.json({
    ok: true,
    from_date: from,
    to_date: to,
    states: out,
    grand,
    syncedAt: new Date().toISOString(),
  });
}
