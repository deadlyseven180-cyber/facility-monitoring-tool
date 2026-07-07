import { readFile } from "fs/promises";
import path from "path";
import { getReport, reportsConfigured } from "@/lib/reports/reportStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DIR = path.join(process.cwd(), ".reports");

const htmlResponse = (html: string) =>
  new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });

/** Serve a previously-saved report as a standalone HTML page. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9]{6,32}$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  // Durable store first (survives this machine being off), then local disk.
  if (reportsConfigured()) {
    try {
      const html = await getReport(id);
      if (html) return htmlResponse(html);
    } catch {
      /* fall through to disk */
    }
  }
  try {
    const html = await readFile(path.join(DIR, `${id}.html`), "utf8");
    return htmlResponse(html);
  } catch {
    return new Response("Report not found or has expired.", { status: 404 });
  }
}
