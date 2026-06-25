import { Tunnel, bin, install } from "cloudflared";
import { existsSync } from "node:fs";

/**
 * Manages a single Cloudflare "quick" tunnel (no account needed) that exposes
 * this locally-running app on a public https URL, so exported reports get a
 * link that works from any network. The tunnel is started lazily on the first
 * share and reused afterwards.
 */

let activeUrl: string | null = null;
let activeTunnel: Tunnel | null = null;
let starting: Promise<string | null> | null = null;

const PORT = process.env.PORT || "3000";
const URL_TIMEOUT_MS = 30_000;

async function start(): Promise<string | null> {
  try {
    // First run downloads the cloudflared binary (~once).
    if (!existsSync(bin)) await install(bin);

    const t = Tunnel.quick(`http://localhost:${PORT}`);
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for tunnel URL.")),
        URL_TIMEOUT_MS,
      );
      t.once("url", (u: string) => {
        clearTimeout(timer);
        resolve(u);
      });
      t.once("error", (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
      t.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Tunnel exited before producing a URL."));
      });
    });

    activeTunnel = t;
    activeUrl = url.replace(/\/+$/, "");

    // If the tunnel dies, clear the cache so the next share restarts it.
    t.once("exit", () => {
      activeUrl = null;
      activeTunnel = null;
    });
    const cleanup = () => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    };
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);

    return activeUrl;
  } catch {
    activeTunnel = null;
    activeUrl = null;
    return null;
  }
}

/**
 * The public https base URL for this app (e.g. https://xxx.trycloudflare.com),
 * or null if a tunnel could not be established. Concurrent callers share one
 * in-flight startup.
 */
export async function getPublicBaseUrl(): Promise<string | null> {
  if (activeUrl) return activeUrl;
  if (!starting) {
    starting = start().finally(() => {
      starting = null;
    });
  }
  return starting;
}
