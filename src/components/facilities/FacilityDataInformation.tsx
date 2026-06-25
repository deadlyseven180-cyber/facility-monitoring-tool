"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Facility {
  id: string;
  name: string;
  address: string;
  facilityId: string;
  status: string;
  category: string;
  stalls: number | null;
}

interface ApiResponse {
  source: "airtable" | "snapshot";
  updatedAt: string;
  count: number;
  facilities: Facility[];
  error?: string;
}

// Refresh cadence — the table updates automatically in the background.
const REFRESH_MS = 90 * 1000;

const PAT_KEY = "airtablePat";

export default function FacilityDataInformation() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem(PAT_KEY);
      const res = await fetch("/api/facilities", {
        cache: "no-store",
        headers: token ? { "x-airtable-pat": token } : {},
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData((await res.json()) as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load facilities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const facilities = data?.facilities ?? [];

  const statuses = useMemo(
    () => [...new Set(facilities.map((f) => f.status).filter(Boolean))].sort(),
    [facilities],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facilities.filter((f) => {
      if (status !== "All" && f.status !== status) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.address.toLowerCase().includes(q) ||
        f.facilityId.toLowerCase().includes(q)
      );
    });
  }, [facilities, query, status]);

  const inOperation = facilities.filter((f) =>
    /in operation/i.test(f.status),
  ).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Facility Data Information
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Facilities synced from the Airtable “FACILITY INFORMATION” table.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={loading ? "animate-spin" : ""}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {/* Status row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total facilities" value={String(facilities.length)} />
        <Stat label="In operation" value={String(inOperation)} tone="emerald" />
        <Stat
          label="Source"
          value={data?.source === "airtable" ? "Airtable (live)" : "Snapshot"}
          tone={data?.source === "airtable" ? "indigo" : "amber"}
        />
        <Stat
          label="Last updated"
          value={
            data?.updatedAt
              ? new Date(data.updatedAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "—"
          }
        />
      </div>

      {/* Live connection status */}
      {data?.source === "airtable" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          ✓ Connected to Airtable — updates automatically.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Showing the stored snapshot. Connect Airtable in{" "}
          <span className="font-semibold">Settings</span> for live automatic
          updates.
          {data?.error && (
            <span className="mt-1 block text-xs opacity-80">({data.error})</span>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, address, or ID…"
          className="grow rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/30"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30"
        >
          <option value="All">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {filtered.length} shown
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left dark:bg-slate-800/60">
              <Th>Facility Name</Th>
              <Th>Address</Th>
              <Th>Facility ID</Th>
              <Th>Status</Th>
              <Th>Category</Th>
              <Th right>Stalls</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((f) => (
              <tr
                key={f.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
              >
                <Td className="font-medium text-slate-800 dark:text-slate-100">
                  {f.name}
                </Td>
                <Td>{f.address || "—"}</Td>
                <Td>{f.facilityId || "—"}</Td>
                <Td>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      /in operation/i.test(f.status)
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {f.status || "—"}
                  </span>
                </Td>
                <Td>{f.category || "—"}</Td>
                <Td right>{f.stalls ?? "—"}</Td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500"
                >
                  No facilities found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > 500 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Showing first 500 of {filtered.length}. Refine your search to narrow.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "emerald" | "indigo" | "amber";
}) {
  const toneMap = {
    slate: "text-slate-900 dark:text-slate-100",
    emerald: "text-emerald-600 dark:text-emerald-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    amber: "text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className={`mt-0.5 truncate text-lg font-semibold ${toneMap[tone]}`}>
        {value}
      </p>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-slate-200 px-4 py-2.5 font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300 ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  className = "",
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`whitespace-nowrap px-4 py-2 text-slate-700 dark:text-slate-300 ${
        right ? "text-right tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
