import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { networkInterfaces } from "os";
import { getPublicBaseUrl } from "@/lib/tunnel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DIR = path.join(process.cwd(), ".reports");

/** First non-internal IPv4 address of this machine (its LAN IP), or null. */
function lanIPv4(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      // Across Node versions family is "IPv4" or the number 4 — accept both.
      if (!a.internal && (String(a.family) === "IPv4" || String(a.family) === "4")) {
        return a.address;
      }
    }
  }
  return null;
}

/**
 * Build the most broadly reachable URL for a saved report. If the request came
 * in over localhost, swap the host for this machine's LAN IP (keeping the port
 * and protocol) so the link works from other devices on the network.
 */
function shareUrl(req: Request, id: string): string {
  const reqUrl = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? reqUrl.protocol.replace(/:$/, "");
  const host = req.headers.get("host") ?? reqUrl.host;
  const [hostname, port] = host.split(":");

  let shareHost = host;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    const ip = lanIPv4();
    if (ip) shareHost = port ? `${ip}:${port}` : ip;
  }
  return `${proto}://${shareHost}/r/${id}`;
}

/** Save an exported report's HTML and return a shareable id. */
export async function POST(req: Request) {
  let body: { html?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const html = body.html;
  if (typeof html !== "string" || html.length === 0) {
    return Response.json({ error: "No report HTML provided." }, { status: 400 });
  }
  if (html.length > 10_000_000) {
    return Response.json({ error: "Report is too large." }, { status: 413 });
  }

  await mkdir(DIR, { recursive: true });
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  await writeFile(path.join(DIR, `${id}.html`), html, "utf8");

  // Prefer a public live URL (Cloudflare tunnel) so the link works from any
  // network; fall back to this machine's LAN address if the tunnel is down.
  const base = await getPublicBaseUrl();
  const url = base ? `${base}/r/${id}` : shareUrl(req, id);
  return Response.json({ id, url, public: Boolean(base) });
}
