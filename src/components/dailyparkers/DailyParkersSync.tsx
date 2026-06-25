"use client";

import { useEffect } from "react";

const POLL_MS = 3 * 60 * 1000; // every 3 minutes

/**
 * Headless background poller. Keeps the Daily Parkers databases synced from
 * Gmail (Apps Script or Gmail API) even though the tab is hidden, so the
 * Overbook Checker always has fresh transient data. Renders nothing.
 */
export default function DailyParkersSync() {
  useEffect(() => {
    let stopped = false;
    async function sync() {
      const url = localStorage.getItem("dpAppsScriptUrl");
      const headers: Record<string, string> = {};
      if (url) {
        headers["x-appsscript-url"] = url;
      } else {
        const cid = localStorage.getItem("gmailClientId");
        const csec = localStorage.getItem("gmailClientSecret");
        const cref = localStorage.getItem("gmailRefreshToken");
        if (!cid || !csec || !cref) return; // not configured yet
        headers["x-gmail-client-id"] = cid;
        headers["x-gmail-client-secret"] = csec;
        headers["x-gmail-refresh-token"] = cref;
      }
      try {
        await fetch("/api/daily-parkers", { cache: "no-store", headers });
      } catch {
        /* ignore — best effort */
      }
    }
    sync();
    const t = setInterval(() => {
      if (!stopped) sync();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);
  return null;
}
