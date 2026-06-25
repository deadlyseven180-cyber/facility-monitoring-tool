"use client";

import { useEffect } from "react";

/**
 * On Render's free tier the service spins down after ~15 min idle. While it
 * wakes (~30-60s), Render answers API calls with a plain-text "404 Not Found"
 * (header `x-render-routing: no-server`) before the Next server is ready — which
 * made `res.json()` throw "Unexpected token 'N'… is not valid JSON".
 *
 * This patches window.fetch once: when a same-origin /api request comes back as
 * a cold-start 404 (no-server / non-JSON 404), it transparently retries with
 * backoff until the server is awake, so callers always get the real response.
 * Genuine JSON 404s (e.g. {error:"not_found"}) are left untouched.
 */
export default function ColdStartGuard() {
  useEffect(() => {
    const w = window as unknown as { __coldGuard?: boolean };
    if (w.__coldGuard) return;
    w.__coldGuard = true;
    const orig = window.fetch.bind(window);

    const isColdStart = (res: Response) =>
      res.status === 404 &&
      (res.headers.get("x-render-routing") === "no-server" ||
        !(res.headers.get("content-type") || "").includes("application/json"));

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const sameApi = /^\/api\//.test(url) || url.includes(`${location.origin}/api/`);
      let res = await orig(input, init);
      if (!sameApi) return res;
      // Up to ~75s of retries (server cold start is usually 30-60s).
      for (let i = 0; i < 15 && isColdStart(res); i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          res = await orig(input, init);
        } catch {
          /* keep waiting through transient network errors during wake */
        }
      }
      return res;
    };

    return () => {
      window.fetch = orig;
      w.__coldGuard = false;
    };
  }, []);

  return null;
}
