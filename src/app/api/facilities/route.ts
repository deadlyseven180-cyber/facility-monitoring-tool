import snapshot from "@/data/facilities.json";

// Airtable "Facility Management Database" → "FACILITY INFORMATION" table.
const BASE_ID = "app9iYUN8J3z2wjXN";
const TABLE_ID = "tblmun9KBYW4aYBe1";

export interface Facility {
  id: string;
  name: string;
  address: string;
  facilityId: string;
  status: string;
  category: string;
  stalls: number | null;
}

// Always re-evaluate on each request (no caching of Airtable data).
export const dynamic = "force-dynamic";

function pick(fields: Record<string, unknown>, key: string): string {
  const v = fields[key];
  if (v == null) return "";
  if (typeof v === "object" && "name" in (v as object))
    return String((v as { name: string }).name);
  return String(v);
}

/** Pull every record from the Airtable table (paginated) using a PAT. */
async function fetchFromAirtable(pat: string): Promise<Facility[]> {
  const facilities: Facility[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`,
    );
    url.searchParams.set("pageSize", "100");
    for (const f of [
      "FACILITY NAME",
      "FACILITY ADDRESS",
      "FACILITY ID",
      "FACILITY STATUS",
      "FACILITY CATEGORY",
      "NO. OF STALLS",
    ]) {
      url.searchParams.append("fields[]", f);
    }
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      records: { id: string; fields: Record<string, unknown> }[];
      offset?: string;
    };
    for (const r of data.records) {
      const name = pick(r.fields, "FACILITY NAME").replace(/\s+/g, " ").trim();
      if (!name) continue;
      const stallsRaw = r.fields["NO. OF STALLS"];
      facilities.push({
        id: r.id,
        name,
        address: pick(r.fields, "FACILITY ADDRESS").replace(/\s+/g, " ").trim(),
        facilityId: pick(r.fields, "FACILITY ID"),
        status: pick(r.fields, "FACILITY STATUS"),
        category: pick(r.fields, "FACILITY CATEGORY"),
        stalls: stallsRaw == null ? null : Number(stallsRaw),
      });
    }
    offset = data.offset;
  } while (offset);
  return facilities;
}

export async function GET(req: Request) {
  // Token may come from the UI (per-browser) or a server env var.
  const pat = req.headers.get("x-airtable-pat") || process.env.AIRTABLE_PAT;

  if (pat) {
    try {
      const facilities = await fetchFromAirtable(pat);
      return Response.json({
        source: "airtable",
        updatedAt: new Date().toISOString(),
        count: facilities.length,
        facilities,
      });
    } catch (e) {
      // Fall back to the bundled snapshot if the live fetch fails.
      return Response.json({
        source: "snapshot",
        error: e instanceof Error ? e.message : "Airtable fetch failed",
        updatedAt: snapshot.updatedAt,
        count: snapshot.count,
        facilities: snapshot.facilities,
      });
    }
  }

  return Response.json({
    source: "snapshot",
    updatedAt: snapshot.updatedAt,
    count: snapshot.count,
    facilities: snapshot.facilities,
  });
}
