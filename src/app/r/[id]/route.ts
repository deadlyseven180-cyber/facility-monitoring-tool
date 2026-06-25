import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), ".reports");

/** Serve a previously-saved report as a standalone HTML page. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9]{6,32}$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const html = await readFile(path.join(DIR, `${id}.html`), "utf8");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response("Report not found or has expired.", { status: 404 });
  }
}
