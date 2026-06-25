"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const CID = "gmailClientId";
const CSEC = "gmailClientSecret";
const CREF = "gmailRefreshToken";
const ASURL = "dpAppsScriptUrl";
const POLL_MS = 3 * 60 * 1000; // refresh every 3 minutes

interface Reservation {
  reservationId: string;
  facility: string;
  bookingDate: string;
  start: string;
  end: string;
}

interface ApiResp {
  connected: boolean;
  updatedAt?: string;
  parkers?: Reservation[];
  cancelled?: Reservation[];
  error?: string;
}

export default function DailyParkers() {
  const [connected, setConnected] = useState(false);
  const [asUrl, setAsUrl] = useState("");
  const [cid, setCid] = useState("");
  const [csec, setCsec] = useState("");
  const [cref, setCref] = useState("");

  const [parkers, setParkers] = useState<Reservation[]>([]);
  const [cancelled, setCancelled] = useState<Reservation[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    const url = localStorage.getItem(ASURL);
    const headers: Record<string, string> = {};
    if (url) {
      headers["x-appsscript-url"] = url;
    } else {
      const clientId = localStorage.getItem(CID);
      const clientSecret = localStorage.getItem(CSEC);
      const refreshToken = localStorage.getItem(CREF);
      if (!clientId || !clientSecret || !refreshToken) return;
      headers["x-gmail-client-id"] = clientId;
      headers["x-gmail-client-secret"] = clientSecret;
      headers["x-gmail-refresh-token"] = refreshToken;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/daily-parkers", {
        cache: "no-store",
        headers,
      });
      const data = (await res.json()) as ApiResp;
      if (!data.connected) {
        setError(data.error ?? "Gmail sync failed.");
      } else {
        setParkers(data.parkers ?? []);
        setCancelled(data.cancelled ?? []);
        setUpdatedAt(data.updatedAt ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gmail sync failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load saved connection and start polling.
  useEffect(() => {
    const saved =
      Boolean(localStorage.getItem(ASURL)) ||
      Boolean(
        localStorage.getItem(CID) &&
          localStorage.getItem(CSEC) &&
          localStorage.getItem(CREF),
      );
    setConnected(saved);
    if (saved) fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!connected) return;
    timer.current = setInterval(fetchData, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [connected, fetchData]);

  function connectAppsScript() {
    if (!asUrl.trim()) return;
    localStorage.setItem(ASURL, asUrl.trim());
    setConnected(true);
    fetchData();
  }

  function connect() {
    if (!cid.trim() || !csec.trim() || !cref.trim()) return;
    localStorage.setItem(CID, cid.trim());
    localStorage.setItem(CSEC, csec.trim());
    localStorage.setItem(CREF, cref.trim());
    setConnected(true);
    fetchData();
  }

  // One-click path: save client creds, then send the user to Google's consent
  // screen. The /google-callback page captures the refresh token and returns.
  function signInWithGoogle() {
    if (!cid.trim() || !csec.trim()) return;
    localStorage.setItem(CID, cid.trim());
    localStorage.setItem(CSEC, csec.trim());
    const redirectUri = `${window.location.origin}/google-callback`;
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({
        client_id: cid.trim(),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        access_type: "offline",
        prompt: "consent",
      }).toString();
    window.location.href = url;
  }

  function disconnect() {
    [CID, CSEC, CREF, ASURL].forEach((k) => localStorage.removeItem(k));
    setConnected(false);
    setParkers([]);
    setCancelled([]);
    setUpdatedAt(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Daily Parkers
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Live SpotHero reservations from Gmail — confirmations (SH Daily
            Parkers) and Cancelled Bookings, for the next 60 days. Auto-refreshes
            every few minutes.
          </p>
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
            >
              {loading && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
                </svg>
              )}
              {loading ? "Syncing…" : "Refresh now"}
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Disconnect
            </button>
          </div>
        )}
      </header>

      {!connected ? (
        <ConnectForm
          asUrl={asUrl}
          setAsUrl={setAsUrl}
          onConnectAppsScript={connectAppsScript}
          cid={cid}
          csec={csec}
          cref={cref}
          setCid={setCid}
          setCsec={setCsec}
          setCref={setCref}
          onConnect={connect}
          onSignIn={signInWithGoogle}
        />
      ) : (
        <>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          )}
          {updatedAt && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Last synced {new Date(updatedAt).toLocaleString()} · auto-refreshes
              every 3 minutes.
            </p>
          )}
          <ReservationTable
            title="SH Daily Parkers"
            accent="text-emerald-600 dark:text-emerald-400"
            rows={parkers}
          />
          <ReservationTable
            title="Cancelled Bookings"
            accent="text-rose-600 dark:text-rose-400"
            rows={cancelled}
          />
        </>
      )}
    </div>
  );
}

function ConnectForm({
  asUrl,
  setAsUrl,
  onConnectAppsScript,
  cid,
  csec,
  cref,
  setCid,
  setCsec,
  setCref,
  onConnect,
  onSignIn,
}: {
  asUrl: string;
  setAsUrl: (v: string) => void;
  onConnectAppsScript: () => void;
  cid: string;
  csec: string;
  cref: string;
  setCid: (v: string) => void;
  setCsec: (v: string) => void;
  setCref: (v: string) => void;
  onConnect: () => void;
  onSignIn: () => void;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const redirectUri = origin ? `${origin}/google-callback` : "";

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/30";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Connect the Daily Parkers feed
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Paste the <span className="font-medium">Apps Script Web app URL</span>{" "}
        (ends in <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">/exec</code>).
        Setup steps are below.
      </p>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          Apps Script URL
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${input} grow`}
            value={asUrl}
            onChange={(e) => setAsUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
          />
          <button
            type="button"
            onClick={onConnectAppsScript}
            disabled={!asUrl.trim()}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            Connect
          </button>
        </div>
      </div>

      <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/50">
        <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">
          How to set up the Apps Script (one-time, ~3 minutes)
        </summary>
        <ol className="mt-2 list-inside list-decimal space-y-1.5 text-slate-600 dark:text-slate-300">
          <li>
            Go to{" "}
            <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline dark:text-indigo-400">
              script.google.com
            </a>{" "}
            → <span className="font-medium">New project</span>.
          </li>
          <li>
            Delete the sample code, paste the contents of{" "}
            <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">apps-script/DailyParkers.gs</code>{" "}
            (from this app&apos;s folder), and Save.
          </li>
          <li>
            Run the <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">setup</code>{" "}
            function once → <span className="font-medium">Review permissions → Allow</span>{" "}
            (with the SpotHero inbox account). This installs a 10-minute auto-refresh.
          </li>
          <li>
            <span className="font-medium">Deploy → New deployment → Web app</span>,
            set <span className="font-medium">Execute as: Me</span> and{" "}
            <span className="font-medium">Who has access: Anyone</span> → Deploy →
            copy the <span className="font-medium">Web app URL</span>.
          </li>
          <li>Paste that URL above and click Connect.</li>
        </ol>
      </details>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          Advanced: connect with the Gmail API instead
        </summary>
        <div className="mt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Client ID
              </label>
              <input className={input} value={cid} onChange={(e) => setCid(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Client Secret
              </label>
              <input className={input} value={csec} onChange={(e) => setCsec(e.target.value)} placeholder="GOCSPX-…" />
            </div>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            disabled={!cid.trim() || !csec.trim()}
            className="mt-3 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            Sign in with Google
          </button>
          {redirectUri && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Register this redirect URI in your OAuth client:{" "}
              <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">{redirectUri}</code>
            </p>
          )}
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              …or paste a Refresh Token
            </label>
            <input className={input} value={cref} onChange={(e) => setCref(e.target.value)} placeholder="1//…" />
            <button
              type="button"
              onClick={onConnect}
              disabled={!cid.trim() || !csec.trim() || !cref.trim()}
              className="mt-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              Connect with token
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function fmtDate(s: string): string {
  if (!s) return "—";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Date(t).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ReservationTable({
  title,
  accent,
  rows,
}: {
  title: string;
  accent: string;
  rows: Reservation[];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className={`mb-3 text-sm font-semibold ${accent}`}>
        {title} ({rows.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400">
              <th className="py-1.5 pr-4">Reservation ID</th>
              <th className="py-1.5 pr-4">Facility</th>
              <th className="py-1.5 pr-4">Booking date</th>
              <th className="py-1.5 pr-4">Start</th>
              <th className="py-1.5">End</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((r, i) => (
              <tr
                key={`${r.reservationId}-${i}`}
                className="border-t border-slate-100 text-slate-700 dark:border-slate-800 dark:text-slate-300"
              >
                <td className="py-1.5 pr-4 font-medium">{r.reservationId}</td>
                <td className="py-1.5 pr-4">{r.facility || "—"}</td>
                <td className="py-1.5 pr-4">{fmtDate(r.bookingDate)}</td>
                <td className="py-1.5 pr-4">{r.start || "—"}</td>
                <td className="py-1.5">{r.end || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400 dark:text-slate-500">
                  No reservations in the next 60 days yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
