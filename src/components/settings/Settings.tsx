"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";

export const PAT_KEY = "airtablePat";
const NAME_KEY = "progressUserName";
const DEFAULT_NAME = "customer.support@yourspotrented.com";

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [pat, setPat] = useState<string | null>(null);
  const [patInput, setPatInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  // Real connection state from a live Airtable read (not just "a token exists").
  const [live, setLive] = useState<"unknown" | "ok" | "fail">("unknown");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    setPat(localStorage.getItem(PAT_KEY) ?? "");
    setUserName(localStorage.getItem(NAME_KEY) ?? DEFAULT_NAME);
    // Verify the saved token actually works (live read), not just that it exists.
    if (localStorage.getItem(PAT_KEY)) test();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveName(v: string) {
    setUserName(v);
    try {
      localStorage.setItem(NAME_KEY, v);
    } catch {
      /* ignore */
    }
  }

  function save() {
    const v = patInput.trim();
    if (!v) return;
    localStorage.setItem(PAT_KEY, v);
    setPat(v);
    setPatInput("");
    setTestResult(null);
    setLive("unknown");
    test(); // immediately verify the new token works
  }

  function disconnect() {
    localStorage.removeItem(PAT_KEY);
    setPat("");
    setTestResult(null);
    setLive("unknown");
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const token = localStorage.getItem(PAT_KEY);
      const res = await fetch("/api/facilities", {
        cache: "no-store",
        headers: token ? { "x-airtable-pat": token } : {},
      });
      const data = await res.json();
      if (data.source === "airtable") {
        setLive("ok");
        setTestResult(`✓ Connected — ${data.count} facilities loaded live.`);
      } else {
        setLive("fail");
        const is403 = typeof data.error === "string" && data.error.includes("403");
        setTestResult(
          is403
            ? "✗ Airtable rejected this token (403 – no access to the base). Recreate the token with the “data.records:read” scope AND add the base that holds FACILITY INFORMATION / CUSTOMER INTERACTIONS, then paste it again below."
            : `✗ Not live${data.error ? `: ${data.error}` : ""}`,
        );
      }
    } catch (e) {
      setLive("fail");
      setTestResult(e instanceof Error ? e.message : "Test failed.");
    } finally {
      setTesting(false);
    }
  }

  const connected = Boolean(pat);
  const badge = !connected
    ? { text: "Not connected", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" }
    : live === "ok"
      ? { text: "Connected (live)", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" }
      : live === "fail"
        ? { text: "Token not working", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" }
        : { text: "Checking…", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Appearance and integrations for the YourSpotRented tool.
        </p>
      </header>

      {/* Appearance */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Appearance
        </h2>
        <p className="mb-4 mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose a theme for the dashboard.
        </p>
        <div className="flex gap-2">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                theme === t
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {t} mode
            </button>
          ))}
        </div>
      </section>

      {/* Your name — used for "Uploaded By" + note authorship */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Your Name
        </h2>
        <p className="mb-4 mt-1 text-sm text-slate-500 dark:text-slate-400">
          Shown as “Uploaded By” in the Facility Progress Checker upload log and
          as the author on notes. Stored only in this browser.
        </p>
        <input
          type="text"
          value={userName}
          onChange={(e) => saveName(e.target.value)}
          placeholder={DEFAULT_NAME}
          className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/30"
        />
      </section>

      {/* Airtable connection */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Airtable Connection
          </h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>
            {badge.text}
          </span>
        </div>
        <p className="mb-4 mt-1 text-sm text-slate-500 dark:text-slate-400">
          Connect a Personal Access Token to pull facility, complaint &amp;
          monthly-booking data live from Airtable. The token needs the{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">data.records:read</code>{" "}
          scope and access to the base that holds FACILITY INFORMATION /
          CUSTOMER INTERACTIONS. Stored only in this browser.
        </p>

        {connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              pat••••••••••••{pat?.slice(-4)}
            </span>
            <button
              type="button"
              onClick={test}
              disabled={testing}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="text-sm font-semibold text-rose-600 hover:underline dark:text-rose-400"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <ol className="mb-3 list-inside list-decimal space-y-1 text-sm text-slate-600 dark:text-slate-400">
              <li>
                Create a token at{" "}
                <a
                  href="https://airtable.com/create/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-indigo-600 underline dark:text-indigo-400"
                >
                  airtable.com/create/tokens
                </a>{" "}
                with scope <code>data.records:read</code> and access to the
                “Facility Management Database” base.
              </li>
              <li>Paste it below and click Save.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={patInput}
                onChange={(e) => setPatInput(e.target.value)}
                placeholder="pat… (Airtable Personal Access Token)"
                className="grow rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/30"
              />
              <button
                type="button"
                onClick={save}
                disabled={!patInput.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
              >
                Save
              </button>
            </div>
          </>
        )}

        {testResult && (
          <p
            className={`mt-3 text-sm ${
              testResult.startsWith("✓")
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {testResult}
          </p>
        )}
      </section>

    </div>
  );
}
