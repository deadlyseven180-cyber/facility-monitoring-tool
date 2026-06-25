export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Exchange an OAuth authorization code for tokens (server-side proxy). */
export async function POST(req: Request) {
  let body: {
    code?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { code, clientId, clientSecret, redirectUri } = body;
  if (!code || !clientId || !clientSecret || !redirectUri) {
    return Response.json({ error: "Missing fields." }, { status: 400 });
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const j = (await res.json()) as {
    refresh_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !j.refresh_token) {
    return Response.json(
      {
        error:
          j.error_description ||
          j.error ||
          "No refresh token returned. Revoke the app at myaccount.google.com/permissions and try again.",
      },
      { status: 502 },
    );
  }
  return Response.json({ refresh_token: j.refresh_token });
}
