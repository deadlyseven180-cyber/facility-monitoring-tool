"use client";

import { useState } from "react";
import type { ComparisonResult } from "@/types/data";
import DataTable from "./DataTable";
import { toCsv, downloadCsv } from "@/lib/csv";

type TabKey = "added" | "removed" | "changed" | "unchanged";

const TAB_META: Record<
  TabKey,
  { label: string; accent: string; row: string }
> = {
  added: {
    label: "Added",
    accent:
      "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30",
    row: "bg-emerald-50/40 hover:bg-emerald-50 dark:bg-emerald-500/5 dark:hover:bg-emerald-500/10",
  },
  removed: {
    label: "Removed",
    accent:
      "text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-500/15 dark:border-red-500/30",
    row: "bg-red-50/40 hover:bg-red-50 dark:bg-red-500/5 dark:hover:bg-red-500/10",
  },
  changed: {
    label: "Changed",
    accent:
      "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30",
    row: "",
  },
  unchanged: {
    label: "Unchanged",
    accent:
      "text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-700",
    row: "hover:bg-slate-50 dark:hover:bg-slate-800/50",
  },
};

export default function ComparisonResults({
  result,
}: {
  result: ComparisonResult;
}) {
  const [tab, setTab] = useState<TabKey>("changed");
  const { summary, columns, keyColumn } = result;

  const counts: Record<TabKey, number> = {
    added: summary.added,
    removed: summary.removed,
    changed: summary.changed,
    unchanged: summary.unchanged,
  };

  function exportCsv() {
    // Flatten changed rows to their new state for export.
    const sections: { name: string; rows: Record<string, string>[] }[] = [
      { name: "added", rows: result.added },
      { name: "removed", rows: result.removed },
      { name: "changed", rows: result.changed.map((c) => c.row) },
      { name: "unchanged", rows: result.unchanged },
    ];
    const cols = ["_status", ...columns];
    const merged = sections.flatMap((s) =>
      s.rows.map((r) => ({ _status: s.name, ...r })),
    );
    downloadCsv("comparison-results.csv", toCsv(cols, merged));
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Data 1 rows" value={summary.data1Rows} tone="slate" />
        <SummaryCard label="Data 2 rows" value={summary.data2Rows} tone="slate" />
        <SummaryCard label="Added" value={summary.added} tone="emerald" />
        <SummaryCard label="Removed" value={summary.removed} tone="red" />
        <SummaryCard label="Changed" value={summary.changed} tone="amber" />
        <SummaryCard
          label="Unchanged"
          value={summary.unchanged}
          tone="slate"
        />
      </div>

      {result.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <ul className="list-inside list-disc space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Matched by key column{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">
            “{keyColumn}”
          </span>
        </p>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_META) as TabKey[]).map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? TAB_META[key].accent
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {TAB_META[key].label} ({counts[key]})
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === "changed" ? (
          <ChangedTable result={result} />
        ) : (
          <DataTable
            columns={columns}
            rows={result[tab]}
            rowClassName={() => TAB_META[tab].row}
          />
        )}
      </div>
    </div>
  );
}

function ChangedTable({ result }: { result: ComparisonResult }) {
  if (result.changed.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
        No changed rows.
      </div>
    );
  }
  return (
    <div className="overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left dark:bg-slate-800/60">
            <th className="border-b border-slate-200 px-4 py-2.5 font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
              {result.keyColumn}
            </th>
            <th className="border-b border-slate-200 px-4 py-2.5 font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
              Changes (old → new)
            </th>
          </tr>
        </thead>
        <tbody>
          {result.changed.map((c) => (
            <tr
              key={c.key}
              className="border-b border-slate-100 align-top last:border-0 hover:bg-amber-50/40 dark:border-slate-800 dark:hover:bg-amber-500/5"
            >
              <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                {c.key}
              </td>
              <td className="px-4 py-2.5">
                <div className="space-y-1.5">
                  {c.changes.map((ch) => (
                    <div key={ch.column} className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {ch.column}
                      </span>
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700 line-through dark:bg-red-500/15 dark:text-red-300">
                        {ch.oldValue || "∅"}
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">→</span>
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        {ch.newValue || "∅"}
                      </span>
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "red" | "amber";
}) {
  const toneMap = {
    slate: "text-slate-900 dark:text-slate-100",
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${toneMap[tone]}`}>{value}</p>
    </div>
  );
}
