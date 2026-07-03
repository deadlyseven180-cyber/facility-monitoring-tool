"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MultiFileUpload from "@/components/shared/MultiFileUpload";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import FacilityRecordsModal from "@/components/shared/FacilityRecordsModal";
import ReportCharts from "./ReportCharts";
import TopFacilitiesChart from "./TopFacilitiesChart";
import PriorityBadge from "./PriorityBadge";
import type { ParsedCsv } from "@/types/data";
import type {
  FacilitySummary,
  FilteredRecord,
  PriorityLevel,
  ReportResult,
} from "@/types/report";
import {
  analyzeReport,
  isAccountingReport,
  type DateRange,
} from "@/lib/reports/analyze";
import {
  mergeReportFiles,
  MERGED_COLUMNS,
  MERGED_HEADERS,
} from "@/lib/reports/merge";
import { filterForCategory, categoryForReason, type IssueCategory } from "@/lib/reports/filters";
import { toIsoDate } from "@/lib/reports/columns";
import { extractSpotHeroData } from "@/lib/reports/spotheroStore";
import { formatCurrency, formatScore } from "@/lib/format";
import {
  buildReportHtml,
  downloadHtml,
  printHtml,
  type ChartImage,
  type TableSnapshot,
} from "@/lib/reportExport";

/** A record from the /api/internal-issues route. */
interface InternalRecord {
  rentalId: string;
  date: string;
  facility: string;
  reason: string;
  state: string;
  amount: number;
  category?: "lot_full" | "inaccessibility";
  source?: string;
  origins?: string[];
}

/** Per-Airtable-source tally of internal Lot Full / Inaccessibility cases. */
interface SourceTally {
  name: string;
  lotFull: number;
  inacc: number;
}

/** Convert internal Airtable issues into the analyzer's merged-row shape. */
function internalToMergedRows(
  records: InternalRecord[],
): Record<string, string>[] {
  return records.map((r) => ({
    __source: "internal",
    reason: r.reason,
    rentalId: r.rentalId,
    spot: r.facility,
    starts: r.date,
    state: r.state || "",
    refund: r.amount ? String(r.amount) : "",
    totalRemit: "",
  }));
}

/** A stored SpotHero complaint from the Google Sheet (Drive). */
interface StoredSpot {
  rentalId: string;
  facility: string;
  date: string;
  category: "lot_full" | "inaccessibility";
}

/** Convert stored SpotHero complaints into the analyzer's merged-row shape. */
function storedSpotToRows(recs: StoredSpot[]): Record<string, string>[] {
  return recs.map((r) => ({
    __source: "spothero",
    reason: r.category === "lot_full" ? "Lot Full" : "Inaccessibility",
    rentalId: r.rentalId,
    spot: r.facility,
    starts: r.date,
    state: "",
    refund: "",
    totalRemit: "",
  }));
}

/** The current calendar month so far (1st → today) — the default date filter. */
function thisMonthRange(): DateRange {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ym = `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  return { start: `${ym}-01`, end: `${ym}-${p(d.getDate())}` };
}

export default function GatherOneReport() {
  const [files, setFiles] = useState<ParsedCsv[]>([]);
  // Internal Lot Full / Inaccessibility rows pulled from Airtable on generate.
  const [internalRows, setInternalRows] = useState<Record<string, string>[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const [stateFilter, setStateFilter] = useState<string>("All");
  const [category, setCategory] = useState<IssueCategory>("all");
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // Per-Airtable-source breakdown of internal cases (RingCentral, Refunds…).
  const [sources, setSources] = useState<SourceTally[]>([]);
  // SpotHero complaints already stored in the Google Sheet (Drive) — gathered
  // into every report, and shown as a count next to "Generate Report".
  const [storedSpot, setStoredSpot] = useState<StoredSpot[]>([]);
  const refreshStored = useCallback(() => {
    fetch("/api/complaint-history?source=spothero")
      .then((r) => r.json())
      .then((j) => {
        if (!Array.isArray(j?.complaints)) return;
        setStoredSpot(
          j.complaints.map((c: { rentalId?: string; facilityName?: string; complaintDate?: string; complaintType?: string }) => ({
            rentalId: c.rentalId || "",
            facility: c.facilityName || "",
            date: c.complaintDate || "",
            category: c.complaintType === "lot_full" ? "lot_full" : "inaccessibility",
          })),
        );
      })
      .catch(() => {});
  }, []);
  useEffect(() => { refreshStored(); }, [refreshStored]);
  // Canonical-facility → state (MA/IL/DC) map, used to fill in the state for
  // facilities whose uploaded rows carry none (e.g. call logs). Cached on the
  // server; fetched here with the Airtable PAT when this machine has one.
  const [facilityStates, setFacilityStates] = useState<Record<string, string>>({});

  // Default the date filter to the current month (set on mount to avoid any
  // server/client date mismatch); the user can still adjust it freely.
  useEffect(() => {
    setDateRange(thisMonthRange());
  }, []);

  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("airtablePat") : null;
    fetch("/api/facility-states", {
      headers: token ? { "x-airtable-pat": token } : {},
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.states) setFacilityStates(d.states);
      })
      .catch(() => {
        /* states fall back to whatever the upload provides */
      });
  }, []);

  // Internal data is always part of a generated report, so the date filter
  // (which scopes internal rows) is shown whenever internal rows are present.
  const hasInternal = internalRows.length > 0;

  // Combine uploaded SpotHero CSV rows + SpotHero stored in Drive + internal
  // Airtable rows into one merged dataset. Stored rows whose Rental ID is also
  // in an uploaded CSV are dropped (the CSV row is richer — it carries refunds).
  const merged = useMemo<ParsedCsv | null>(() => {
    const spotheroRows = files.length
      ? mergeReportFiles(
          files.map((f) => ({ data: f, source: "spothero" as const })),
        ).rows
      : [];
    const uploadedIds = new Set(spotheroRows.map((r) => String(r.rentalId || "").trim()).filter(Boolean));
    const storedRows = storedSpotToRows(storedSpot.filter((s) => !s.rentalId || !uploadedIds.has(s.rentalId.trim())));
    if (spotheroRows.length === 0 && storedRows.length === 0 && internalRows.length === 0) return null;
    return {
      headers: [...MERGED_HEADERS],
      rows: [...spotheroRows, ...storedRows, ...internalRows],
      fileName:
        files.map((f) => f.fileName).join(", ") || "Internal + stored SpotHero (Airtable/Drive)",
    };
  }, [files, storedSpot, internalRows]);

  const result = useMemo<ReportResult | null>(() => {
    if (!merged || !analyzed) return null;
    try {
      return analyzeReport(merged, filterForCategory(category), {
        columns: MERGED_COLUMNS,
        stateFilter,
        dateRange,
        facilityStates,
      });
    } catch {
      return null;
    }
  }, [merged, analyzed, stateFilter, dateRange, category, facilityStates]);

  function reset() {
    setAnalyzed(false);
    setStateFilter("All");
    setCategory("all");
    setDateRange(thisMonthRange());
    setError(null);
    setInternalRows([]);
    setSources([]);
  }

  function handleClear() {
    reset();
    setFiles([]);
  }

  // Pull internal issues from Airtable + SpotHero stored in Drive, persist any
  // freshly-uploaded SpotHero CSV to Drive, and generate the full report.
  async function generate() {
    setError(null);
    setAnalyzing(true);
    try {
      // Use this browser's saved token if present; otherwise fall back to the
      // server-side AIRTABLE_PAT — identical to the Facility Progress Checker —
      // so the report works on any device/network without pasting a token.
      const pat =
        typeof window !== "undefined"
          ? localStorage.getItem("airtablePat")
          : null;
      const haveSpot = files.length > 0 || storedSpot.length > 0;

      // Internal complaints (best-effort — don't block a SpotHero-only report).
      let records: InternalRecord[] = [];
      try {
        const res = await fetch("/api/internal-issues?category=all", { headers: pat ? { "x-airtable-pat": pat } : {} });
        const j = await res.json();
        if (res.ok && j?.ok) records = j.records as InternalRecord[];
        else if (!haveSpot) { setError(j?.description || j?.error || "Could not load internal issues from Airtable."); return; }
      } catch {
        if (!haveSpot) { setError("Could not load internal issues from Airtable."); return; }
      }

      const rows = internalToMergedRows(records);
      if (rows.length === 0 && !haveSpot) {
        setError("No Lot Full or Inaccessibility data found (internal, uploads, or stored SpotHero).");
        return;
      }

      // Tally each Airtable source's cases (deduped by Rental ID upstream).
      const agg = new Map<string, SourceTally>();
      for (const r of records) {
        const o = r.source || r.origins?.[0] || "Airtable";
        const e = agg.get(o) ?? { name: o, lotFull: 0, inacc: 0 };
        if (r.category === "lot_full") e.lotFull++;
        else if (r.category === "inaccessibility") e.inacc++;
        agg.set(o, e);
      }
      setSources([...agg.values()].sort((a, b) => b.lotFull + b.inacc - (a.lotFull + a.inacc)));
      setInternalRows(rows);
      setAnalyzed(true);

      // Persist any uploaded SpotHero CSV to the Google Sheet (Drive) — same as
      // the Facility Progress Checker's upload — then refresh the stored count.
      if (files.length) {
        const spotheroRows = mergeReportFiles(files.map((f) => ({ data: f, source: "spothero" as const }))).rows;
        const incidents = spotheroRows
          .map((r) => {
            const cat = categoryForReason(String(r.reason || ""));
            const facility = String(r.spot || "").trim();
            if ((cat !== "lot_full" && cat !== "inaccessibility") || !facility) return null;
            return { facility, date: toIsoDate(String(r.starts || "")) ?? "", rentalId: String(r.rentalId || "").trim(), category: cat };
          })
          .filter((x): x is { facility: string; date: string; rentalId: string; category: "lot_full" | "inaccessibility" } => x !== null);
        const fileName = files.map((f) => f.fileName).join(", ");
        if (incidents.length) {
          const uploadedBy = (typeof window !== "undefined" && localStorage.getItem("progressUserName")) || "Gather Data";
          await fetch("/api/complaint-history", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(pat ? { "x-airtable-pat": pat } : {}) },
            body: JSON.stringify({ fileName, uploadedBy, incidents }),
          }).catch(() => {});
          refreshStored();
        }
        // Persist raw rows + per-facility financials (net remit, refunds,
        // reservations, complaints) so the History view can show them later
        // without re-uploading. De-duped by fileName server-side.
        const { rows: shRows, financials } = extractSpotHeroData(files, fileName, new Date().toISOString());
        fetch("/api/spothero-store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName, rows: shRows, financials }),
        }).catch(() => {});
      }
    } catch {
      setError("Something went wrong generating the report.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Before generating: upload card. After: date filter + Export/Clear. */}
      {!analyzed || !result ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Generate Report
          </h2>
          <p className="mb-4 mt-1 text-sm text-slate-500 dark:text-slate-400">
            Generate a{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Lot Full
            </span>{" "}
            or{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Inaccessibility
            </span>{" "}
            report. Internal issues (from the Refunds &amp; Reimbursements table
            in Airtable) are gathered{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              automatically from Airtable
            </span>
            . To include SpotHero too, upload one or more SpotHero accounting
            CSVs (
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
              cp_accounting_detail…
            </code>
            ) — the button below switches to a full SpotHero + Internal report.
            Choose the category after generating.
          </p>

          <MultiFileUpload
            value={files}
            onChange={setFiles}
            checkDuplicateDateRange
            validate={(data) =>
              isAccountingReport(data.fileName)
                ? null
                : "Only SpotHero accounting CSVs are accepted here — the file name must begin with “cp_accounting_detail”."
            }
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={analyzing}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
            >
              {analyzing && (
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z"
                  />
                </svg>
              )}
              {analyzing
                ? "Generating…"
                : files.length > 0
                  ? "Generate Full Report (SpotHero + Internal)"
                  : "Generate Report"}
            </button>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              <b className="text-slate-700 dark:text-slate-200">{storedSpot.length.toLocaleString()}</b> stored SpotHero complaint{storedSpot.length === 1 ? "" : "s"} in Drive will be included{files.length > 0 ? " (plus your uploaded CSV)" : ""}.
            </span>
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Generate Report
          </h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {hasInternal && (
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            )}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as IssueCategory)}
              aria-label="Filter by issue category"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30"
            >
              <option value="all">All</option>
              <option value="lot_full">Lot Full</option>
              <option value="inaccessibility">Inaccessibility</option>
            </select>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              aria-label="Filter by state"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30"
            >
              <option value="All">All States</option>
              <option value="MA">MA</option>
              <option value="IL">IL</option>
              <option value="DC">DC</option>
            </select>
            {merged && <ExportMenu result={result} dateRange={dateRange} />}
            <button
              type="button"
              onClick={handleClear}
              title="Clear data"
              aria-label="Clear data"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {analyzed && sources.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Internal Data Sources (Airtable)</h3>
          <p className="mb-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">Lot Full &amp; Inaccessibility cases gathered from each connected table.</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-1.5 pr-3">Source table</th>
                  <th className="px-3 text-right">Lot Full</th>
                  <th className="px-3 text-right">Inaccessibility</th>
                  <th className="px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-3 font-medium text-slate-800 dark:text-slate-100">{s.name}</td>
                    <td className="px-3 text-right tabular-nums">{s.lotFull}</td>
                    <td className="px-3 text-right tabular-nums">{s.inacc}</td>
                    <td className="px-3 text-right font-semibold tabular-nums">{s.lotFull + s.inacc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {analyzed && result && <ReportDashboard result={result} />}
    </div>
  );
}

/* ----------------------------- Dashboard ----------------------------- */

function ReportDashboard({ result }: { result: ReportResult }) {
  const { totals, warnings } = result;
  const cat = result.filterLabel; // "All Issues" | "Lot Full" | "Inaccessibility"

  // Which issue categories each facility's complaints fall under.
  const typeByFacility = useMemo(() => {
    const seen = new Map<string, { lf: boolean; ia: boolean }>();
    for (const r of result.records) {
      const e = seen.get(r.facility) ?? { lf: false, ia: false };
      if (r.category === "lot_full") e.lf = true;
      else if (r.category === "inaccessibility") e.ia = true;
      seen.set(r.facility, e);
    }
    const out = new Map<string, string>();
    for (const [f, { lf, ia }] of seen) {
      out.set(f, lf && ia ? "Both" : lf ? "Lot Full" : ia ? "Inaccessibility" : "—");
    }
    return out;
  }, [result]);

  const complaintRate =
    totals.reservations > 0
      ? (totals.incidentCount / totals.reservations) * 100
      : 0;
  const avgRevenueAll =
    totals.reservations > 0 ? totals.netRemitTotal / totals.reservations : 0;
  const refundRateAll =
    totals.netRemitTotal > 0
      ? (totals.refundAllTotal / totals.netRemitTotal) * 100
      : 0;

  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <ul className="list-inside list-disc space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Top-line stats — each card stacks a primary + secondary metric. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          tone="indigo"
          label={`${cat} Incidents`}
          value={String(totals.incidentCount)}
          subLabel="Complaint Rate"
          subValue={`${complaintRate.toFixed(2)}%`}
        />
        <StatCard
          tone="teal"
          label="Total Net Remit"
          value={formatCurrency(totals.netRemitTotal)}
          subLabel="Average Revenue"
          subValue={formatCurrency(avgRevenueAll)}
        />
        <StatCard
          tone="red"
          label={`Total ${cat} Refunds`}
          value={formatCurrency(totals.refundTotal)}
          subLabel="Refund Rate"
          subValue={`${refundRateAll.toFixed(2)}%`}
        />
        <StatCard
          tone="amber"
          label={`SpotHero ${cat}`}
          value={String(totals.spotHeroLotFull)}
          subLabel={`Internal ${cat}`}
          subValue={String(totals.internalLotFull)}
        />
      </div>

      {totals.inaccessibilityCount > 0 && (
        <p className="-mt-3 text-xs text-slate-500 dark:text-slate-400">
          Internal {cat} total includes{" "}
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            {totals.internalInaccessibility} Inaccessibility
          </span>{" "}
          + {totals.internalLotFull - totals.internalInaccessibility} Lot Full ={" "}
          {totals.internalLotFull}. SpotHero includes{" "}
          {totals.spotHeroInaccessibility} Inaccessibility +{" "}
          {totals.spotHeroLotFull - totals.spotHeroInaccessibility} Lot Full.
        </p>
      )}

      {/* Attention Required — top 5 facilities by complaints, per category */}
      <Section
        title="Attention Required"
        subtitle="Top 5 facilities by complaints — Lot Full and Inaccessibility"
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TopFacilitiesChart result={result} category="lot_full" limit={5} />
          <TopFacilitiesChart
            result={result}
            category="inaccessibility"
            limit={5}
          />
        </div>
      </Section>

      {/* Charts */}
      <Section title="Charts" subtitle={`Visual breakdown of ${cat} impact`}>
        <ReportCharts result={result} />
      </Section>

      {/* Facility Summary table — filterable by priority + sortable columns */}
      <Section
        title="Facility Summary"
        subtitle="Filter by priority; click a column to sort"
      >
        <FacilitySummaryTable
          facilities={result.facilities}
          typeByFacility={typeByFacility}
          records={result.records}
        />
      </Section>

    </div>
  );
}

/* ------------------------- Facility Summary table ------------------------- */

type SortKey =
  | "incidentCount"
  | "refundColumnTotal"
  | "avgRevPerReservation"
  | "netRemit"
  | "refundRate"
  | "priorityScore";

function facilityRefundRate(f: FacilitySummary): number {
  return f.netRemit > 0 ? (f.refundColumnTotal / f.netRemit) * 100 : 0;
}

function typeStyle(t: string): string {
  if (t === "Lot Full")
    return "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300";
  if (t === "Inaccessibility")
    return "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300";
  if (t === "Both")
    return "bg-slate-200 text-slate-700 dark:bg-slate-600/40 dark:text-slate-200";
  return "bg-slate-100 text-slate-400 dark:bg-slate-700/40 dark:text-slate-500";
}

function FacilitySummaryTable({
  facilities,
  typeByFacility,
  records,
}: {
  facilities: FacilitySummary[];
  typeByFacility: Map<string, string>;
  records: FilteredRecord[];
}) {
  const [priority, setPriority] = useState<"All" | PriorityLevel>("All");
  const [sortKey, setSortKey] = useState<SortKey>("incidentCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRows = useMemo(() => {
    if (!picked) return [];
    return records
      .filter((r) => r.facility === picked)
      .sort((a, b) => (b.starts || "").localeCompare(a.starts || ""))
      .map((r) => ({
        rentalId: r.rentalId,
        date: r.starts,
        type: r.category === "lot_full" ? "Lot Full" : r.category === "inaccessibility" ? "Inaccessibility" : "Other",
        state: r.state || "",
        refund: r.refundAmount || null,
      }));
  }, [picked, records]);

  // Only the top 50 facilities (by the current sort) are shown.
  const TOP_N = 50;
  const filteredCount = useMemo(
    () =>
      priority === "All"
        ? facilities.length
        : facilities.filter((f) => f.priorityLevel === priority).length,
    [facilities, priority],
  );
  const rows = useMemo(() => {
    const filtered =
      priority === "All"
        ? facilities
        : facilities.filter((f) => f.priorityLevel === priority);
    const value = (f: FacilitySummary): number =>
      sortKey === "refundRate" ? facilityRefundRate(f) : f[sortKey];
    return [...filtered]
      .sort((a, b) => {
        const d = value(a) - value(b);
        return sortDir === "asc" ? d : -d;
      })
      .slice(0, TOP_N);
  }, [facilities, priority, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className="cursor-pointer select-none whitespace-nowrap border-b border-slate-200 px-2.5 py-2 text-right font-semibold text-slate-600 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300 dark:hover:text-indigo-400"
        title={`Sort by ${label}`}
      >
        {label}
        <span className="ml-1 text-[10px] text-indigo-500">
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </th>
    );
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Priority
        </span>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as "All" | PriorityLevel)}
          aria-label="Filter by priority"
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30"
        >
          <option value="All">All</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table data-report-table="facility" className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-left dark:bg-slate-800/60">
              <FTh>#</FTh>
              <FTh>Priority</FTh>
              <FTh>State</FTh>
              <FTh>Facility</FTh>
              <FTh>Type</FTh>
              <SortTh label="Complaints" k="incidentCount" />
              <SortTh label="Refunds" k="refundColumnTotal" />
              <SortTh label="Avg Rev" k="avgRevPerReservation" />
              <SortTh label="Net Remit" k="netRemit" />
              <SortTh label="Refund Rate" k="refundRate" />
              <SortTh label="Score" k="priorityScore" />
            </tr>
          </thead>
          <tbody>
            {rows.map((f, i) => {
              const refundRate = facilityRefundRate(f);
              const type = typeByFacility.get(f.facility) ?? "—";
              return (
                <tr
                  key={f.facility}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                >
                  <FTd className="text-slate-400 dark:text-slate-500">
                    {i + 1}
                  </FTd>
                  <FTd>
                    <PriorityBadge level={f.priorityLevel} />
                  </FTd>
                  <FTd className="font-medium text-slate-600 dark:text-slate-300">
                    {f.state}
                  </FTd>
                  <FTd
                    className="max-w-[200px] truncate"
                    title={`${f.facility} — click for case details`}
                  >
                    <button
                      type="button"
                      onClick={() => setPicked(f.facility)}
                      className="max-w-full truncate text-left font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {f.facility}
                    </button>
                  </FTd>
                  <FTd>
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeStyle(type)}`}
                    >
                      {type}
                    </span>
                  </FTd>
                  <FTd right>{f.incidentCount}</FTd>
                  <FTd right>{formatCurrency(f.refundColumnTotal)}</FTd>
                  <FTd right>{formatCurrency(f.avgRevPerReservation)}</FTd>
                  <FTd right>{formatCurrency(f.netRemit)}</FTd>
                  <FTd
                    right
                    className={`font-semibold ${
                      refundRate >= 30
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {refundRate.toFixed(2)}%
                  </FTd>
                  <FTd
                    right
                    className="font-semibold text-slate-800 dark:text-slate-100"
                  >
                    {formatScore(f.priorityScore)}
                  </FTd>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-6 text-center text-slate-400 dark:text-slate-500"
                >
                  No facilities match this priority.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filteredCount > TOP_N && (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          Showing top {TOP_N} of {filteredCount} facilities.
        </p>
      )}
      {picked && (
        <FacilityRecordsModal facility={picked} rows={pickedRows} onClose={() => setPicked(null)} />
      )}
    </div>
  );
}

/* ----------------------------- Header controls ----------------------------- */

/**
 * Capture every chart canvas in the report as a PNG (composited onto the
 * theme's card background so axis text stays readable), with its title.
 */
function snapshotCharts(): ChartImage[] {
  const dark = document.documentElement.classList.contains("dark");
  const bg = dark ? "#0f172a" : "#ffffff";
  const canvases = Array.from(
    document.querySelectorAll<HTMLCanvasElement>("main canvas"),
  );
  return canvases.map((c) => {
    const card = c.closest(".rounded-2xl");
    const h4 = card?.querySelector("h4")?.textContent?.trim();
    const h3 = c.closest("section")?.querySelector("h3")?.textContent?.trim();
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext("2d");
    if (ctx) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(c, 0, 0);
    }
    return {
      title: h4 || h3 || "Chart",
      section: h3 || "Charts",
      dataUrl: tmp.toDataURL("image/png"),
    };
  });
}

/**
 * Capture the dashboard's data tables (facility summary + records) exactly as
 * rendered — respecting the user's current sort/filter — for the export.
 */
function snapshotTables(): TableSnapshot[] {
  const out: TableSnapshot[] = [];
  document
    .querySelectorAll<HTMLTableElement>("main [data-report-table]")
    .forEach((table) => {
      const kind = table.getAttribute("data-report-table");
      const title =
        table.closest("section")?.querySelector("h3")?.textContent?.trim() ?? "";
      const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
        (th.textContent ?? "").replace(/[▲▼↕]/g, "").trim(),
      );
      let rows = Array.from(table.querySelectorAll("tbody tr"))
        .map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) =>
            (td.textContent ?? "").trim(),
          ),
        )
        .filter((r) => r.length === headers.length);
      // The report's facility summary shows only the top 50 (by current sort).
      if (kind === "facility") rows = rows.slice(0, 50);
      out.push({ title, headers, rows });
    });
  return out;
}

function ExportMenu({
  result,
  dateRange,
}: {
  result: ReportResult;
  dateRange: DateRange;
}) {
  const [open, setOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharePublic, setSharePublic] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function buildHtml() {
    return buildReportHtml(
      result,
      new Date().toLocaleString(),
      snapshotCharts(),
      dateRange,
      snapshotTables(),
    );
  }

  function run(kind: "html" | "pdf") {
    setOpen(false);
    const html = buildHtml();
    if (kind === "html") downloadHtml("lot-full-report.html", html);
    else printHtml(html);
  }

  async function share() {
    setOpen(false);
    setSharing(true);
    setShareError(null);
    setShareUrl(null);
    setCopied(false);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: buildHtml() }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) throw new Error(data.error || "Could not create link.");
      // Server returns a public live URL when a tunnel is up, else a LAN URL.
      const url = data.url || `${window.location.origin}/r/${data.id}`;
      setShareUrl(url);
      setSharePublic(Boolean(data.public));
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {
        // clipboard may be unavailable; the URL is still shown
      }
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Could not create link.");
    } finally {
      setSharing(false);
    }
  }

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      // ignore
    }
  }

  const itemCls =
    "block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={sharing}
        title={sharing ? "Creating link…" : "Export or share the report"}
        aria-label="Export or share the report"
        className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        {sharing ? (
          <svg className="h-[18px] w-[18px] animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
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
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <button type="button" onClick={() => run("html")} className={itemCls}>
              Download HTML
            </button>
            <button type="button" onClick={() => run("pdf")} className={itemCls}>
              Download PDF
            </button>
            <button type="button" onClick={share} className={itemCls}>
              Copy share link
            </button>
          </div>
        </>
      )}

      {(shareUrl || shareError) && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {shareError ? (
            <p className="text-rose-600 dark:text-rose-400">{shareError}</p>
          ) : (
            <>
              <p className="mb-2 font-medium text-slate-700 dark:text-slate-200">
                {copied ? "Link copied to clipboard ✓" : "Shareable link"}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl ?? ""}
                  onFocus={(e) => e.target.select()}
                  className="grow rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Copy
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                {sharePublic
                  ? "Live public link — anyone with the URL can open it from any network."
                  : "Network link — works for anyone on the same network as this server."}
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setShareUrl(null);
              setShareError(null);
            }}
            className="mt-2 text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Small UI atoms ----------------------------- */

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        {subtitle && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  subLabel,
  subValue,
  tone,
}: {
  label: string;
  value: string;
  subLabel: string;
  subValue: string;
  tone: "indigo" | "red" | "amber" | "teal";
}) {
  const toneMap = {
    indigo: "text-indigo-600 dark:text-indigo-400",
    red: "text-rose-600 dark:text-rose-400",
    amber: "text-amber-600 dark:text-amber-400",
    teal: "text-teal-600 dark:text-teal-400",
  };
  const barMap = {
    indigo: "bg-indigo-500",
    red: "bg-rose-500",
    amber: "bg-amber-500",
    teal: "bg-teal-500",
  };
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <span className={`absolute inset-x-0 top-0 h-1 ${barMap[tone]}`} />
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className={`mt-0.5 truncate text-xl font-bold ${toneMap[tone]}`}>
        {value}
      </p>
      <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {subLabel}
        </p>
        <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
          {subValue}
        </p>
      </div>
    </div>
  );
}

// Compact header/cell for the dense Facility Summary table.
function FTh({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-slate-200 px-2.5 py-2 font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300 ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function FTd({
  children,
  right,
  className = "",
  title,
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={`whitespace-nowrap px-2.5 py-1.5 text-slate-700 dark:text-slate-300 ${
        right ? "text-right tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
