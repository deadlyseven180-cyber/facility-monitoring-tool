"use client";

import { useEffect, useMemo, useState } from "react";
import MultiFileUpload from "@/components/shared/MultiFileUpload";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import FacilityRecordsModal from "@/components/shared/FacilityRecordsModal";
import ReportCharts, {
  YearComparisonChart,
  RefundBySourceChart,
  RateVsRefundChart,
} from "./ReportCharts";
import TopFacilitiesChart from "./TopFacilitiesChart";
import PriorityBadge from "./PriorityBadge";
import type { ParsedCsv } from "@/types/data";
import type {
  FacilitySummary,
  FilteredRecord,
  MonthlyDetail,
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
import { filterForCategory, type IssueCategory } from "@/lib/reports/filters";
import { toIsoDate } from "@/lib/reports/columns";
import { formatCurrency, formatScore } from "@/lib/format";
import {
  buildReportHtml,
  downloadHtml,
  printHtml,
  type ChartImage,
  type TableSnapshot,
} from "@/lib/reportExport";
import MonthlyDetailTables from "./MonthlyDetailTables";

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
    // Store internal refunds as NEGATIVE (like SpotHero's column L), so the
    // combined "Total Refunds" adds SpotHero + internal in the same direction.
    refund: r.amount ? String(-Math.abs(r.amount)) : "",
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

/** Shared styling for the report's filter dropdowns. */
const filterSelectCls =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30";

const MONTHS_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
/** Primary markets the per-state charts cover. */
const MARKETS = ["MA", "IL", "DC"];
/** "2026-06" → "Jun 2026". */
function fmtYm(ym: string): string {
  return ym ? `${MONTHS_ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "";
}

export default function GatherOneReport() {
  const [files, setFiles] = useState<ParsedCsv[]>([]);
  // Internal Lot Full / Inaccessibility rows pulled from Airtable on generate.
  const [internalRows, setInternalRows] = useState<Record<string, string>[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const [stateFilter, setStateFilter] = useState<string>("All");
  const [category, setCategory] = useState<IssueCategory>("all");
  // Source filter: All / SpotHero / Internal.
  const [source, setSource] = useState<"all" | "spothero" | "internal">("all");
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
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

  // Combine the uploaded SpotHero CSV rows + live internal Airtable rows into
  // one merged dataset. Nothing is read from stored/Drive data.
  const merged = useMemo<ParsedCsv | null>(() => {
    const spotheroRows = files.length
      ? mergeReportFiles(
          files.map((f) => ({ data: f, source: "spothero" as const })),
        ).rows
      : [];
    if (spotheroRows.length === 0 && internalRows.length === 0) return null;
    return {
      headers: [...MERGED_HEADERS],
      rows: [...spotheroRows, ...internalRows],
      fileName: files.map((f) => f.fileName).join(", ") || "Internal (Airtable)",
    };
  }, [files, internalRows]);

  // Scope the merged dataset to the selected source (All / SpotHero / Internal).
  const scopedMerged = useMemo<ParsedCsv | null>(() => {
    if (!merged) return null;
    if (source === "all") return merged;
    return { ...merged, rows: merged.rows.filter((r) => r.__source === source) };
  }, [merged, source]);

  const result = useMemo<ReportResult | null>(() => {
    if (!scopedMerged || !analyzed) return null;
    try {
      return analyzeReport(scopedMerged, filterForCategory(category), {
        columns: MERGED_COLUMNS,
        stateFilter,
        dateRange,
        facilityStates,
      });
    } catch {
      return null;
    }
  }, [scopedMerged, analyzed, stateFilter, dateRange, category, facilityStates]);

  // All sources + all dates (category/state filtered, source-INdependent) — for
  // the Year-over-Year chart, which always combines internal + SpotHero and
  // uses the full history regardless of the Source dropdown / date range.
  const resultAllSources = useMemo<ReportResult | null>(() => {
    if (!merged || !analyzed) return null;
    try {
      return analyzeReport(merged, filterForCategory(category), {
        columns: MERGED_COLUMNS,
        stateFilter,
        facilityStates,
      });
    } catch {
      return null;
    }
  }, [merged, analyzed, stateFilter, category, facilityStates]);

  // Shared "Attention Required" month — drives the Top-5 charts AND the
  // Recommended Action Plan / Preventive Measures. "" resolves to the latest
  // month (preferring the newest uploaded SpotHero month).
  const [attnMonth, setAttnMonth] = useState<string>("");
  const attn = useMemo(() => {
    const recs = result?.records ?? [];
    let maxSpot = "";
    let maxAny = "";
    const set = new Set<string>();
    for (const r of recs) {
      const ym = (toIsoDate(r.starts) ?? "").slice(0, 7);
      if (!ym) continue;
      set.add(ym);
      if (ym > maxAny) maxAny = ym;
      if (r.source === "spothero" && ym > maxSpot) maxSpot = ym;
    }
    return { months: [...set].sort().reverse(), def: maxSpot || maxAny };
  }, [result]);
  const activeAttn = attn.months.includes(attnMonth) ? attnMonth : attn.def;

  function reset() {
    setAnalyzed(false);
    setStateFilter("All");
    setCategory("all");
    setSource("all");
    setAttnMonth("");
    setDateRange(thisMonthRange());
    setError(null);
    setInternalRows([]);
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
      const haveSpot = files.length > 0;

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
        setError("No Lot Full or Inaccessibility data found (internal Airtable or an uploaded SpotHero CSV).");
        return;
      }

      setInternalRows(rows);
      setAnalyzed(true);
      // Uploaded SpotHero CSVs are analyzed in-memory only — the report no
      // longer persists the uploaded file's data to the Google Sheet / Drive.
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
              Internal refunds are gathered from Airtable automatically; upload a SpotHero CSV to include it.
            </span>
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Report</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Filter below — your Export / PDF mirrors exactly what&apos;s shown.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {hasInternal && (
                <Field label="Date range">
                  <DateRangeFilter value={dateRange} onChange={setDateRange} />
                </Field>
              )}
              <Field label="Category">
                <select value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)} aria-label="Filter by issue category" className={filterSelectCls}>
                  <option value="all">All</option>
                  <option value="lot_full">Lot Full</option>
                  <option value="inaccessibility">Inaccessibility</option>
                </select>
              </Field>
              <Field label="Source">
                <select value={source} onChange={(e) => setSource(e.target.value as "all" | "spothero" | "internal")} aria-label="Filter by data source" className={filterSelectCls}>
                  <option value="all">All Sources</option>
                  <option value="spothero">SpotHero</option>
                  <option value="internal">Internal</option>
                </select>
              </Field>
              <Field label="State">
                <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Filter by state" className={filterSelectCls}>
                  <option value="All">All States</option>
                  <option value="MA">MA</option>
                  <option value="IL">IL</option>
                  <option value="DC">DC</option>
                </select>
              </Field>
              <div className="flex items-center gap-2 self-end">
                {merged && <ExportMenu result={result} dateRange={dateRange} stateFilter={stateFilter} attnMonth={activeAttn} detailMonthly={(resultAllSources ?? result).detailMonthly} />}
                <button
                  type="button"
                  onClick={handleClear}
                  title="Clear data"
                  aria-label="Clear data"
                  className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {analyzed && result && (
        <ReportDashboard
          result={result}
          stateFilter={stateFilter}
          sourceYoyRecords={(resultAllSources ?? result).records}
          sourceDetail={(resultAllSources ?? result).detailMonthly}
          attnMonths={attn.months}
          attnMonth={activeAttn}
          onAttnMonth={setAttnMonth}
        />
      )}
    </div>
  );
}

/* ----------------------------- Dashboard ----------------------------- */

function ReportDashboard({
  result,
  stateFilter,
  sourceYoyRecords,
  sourceDetail,
  attnMonths,
  attnMonth,
  onAttnMonth,
}: {
  result: ReportResult;
  stateFilter: string;
  sourceYoyRecords: FilteredRecord[];
  sourceDetail: MonthlyDetail[];
  attnMonths: string[];
  attnMonth: string;
  onAttnMonth: (m: string) => void;
}) {
  const { totals, warnings } = result;
  const cat = result.filterLabel; // "All Issues" | "Lot Full" | "Inaccessibility"

  // Which issue categories each facility's complaints fall under.
  // Keyed by `${facility}|${year}` so each facility-year row shows its own type.
  const typeByFacility = useMemo(() => {
    const seen = new Map<string, { lf: boolean; ia: boolean }>();
    for (const r of result.records) {
      const y = (toIsoDate(r.starts) ?? "").slice(0, 4);
      const k = `${r.facility}|${y}`;
      const e = seen.get(k) ?? { lf: false, ia: false };
      if (r.category === "lot_full") e.lf = true;
      else if (r.category === "inaccessibility") e.ia = true;
      seen.set(k, e);
    }
    const out = new Map<string, string>();
    for (const [k, { lf, ia }] of seen) {
      out.set(k, lf && ia ? "Both" : lf ? "Lot Full" : ia ? "Inaccessibility" : "—");
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
  // Refund split: SpotHero (uploaded CSV column L) vs internal (Airtable).
  const spotheroRefund = totals.catRefundColumnTotal;
  const internalRefund = totals.refundTotal - totals.catRefundColumnTotal;
  const stateLabel = stateFilter === "All" ? "All States" : stateFilter;

  // States to render one chart each for: the selected state, or every MA/IL/DC
  // market present in the data (so uploading IL + MA → a chart per state, and
  // filtering to one state hides the others). "" = all states in a single chart.
  const attnStates = useMemo(() => {
    if (stateFilter !== "All") return [stateFilter];
    const recs = attnMonth
      ? result.records.filter((r) => (toIsoDate(r.starts) ?? "").slice(0, 7) === attnMonth)
      : result.records;
    const present = new Set(recs.map((r) => r.state));
    const m = MARKETS.filter((s) => present.has(s));
    return m.length ? m : [""];
  }, [stateFilter, result, attnMonth]);
  const yoyStates = useMemo(() => {
    if (stateFilter !== "All") return [stateFilter];
    const present = new Set(sourceYoyRecords.map((r) => r.state));
    const m = MARKETS.filter((s) => present.has(s));
    return m.length ? m : [""];
  }, [stateFilter, sourceYoyRecords]);
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
          tone="indigo"
          label="Reservations (CSV)"
          value={totals.spotHeroReservations.toLocaleString()}
          subLabel="State"
          subValue={stateLabel}
        />
        <StatCard
          tone="red"
          label={`Total ${cat} Refunds`}
          value={formatCurrency(totals.refundTotal)}
          subLabel="Refund Rate"
          subValue={`${refundRateAll.toFixed(2)}%`}
        />
        <StatCard
          tone="red"
          label="SpotHero Refunds"
          value={formatCurrency(spotheroRefund)}
          subLabel="Internal Refunds"
          subValue={formatCurrency(internalRefund)}
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

      {/* Attention Required — one Top-5 chart per state (MA/IL/DC present, or
          the selected state) for the picked month. */}
      <Section
        title="Attention Required"
        subtitle="Top 5 facilities by complaints per state for the selected month — the Action Plan & Preventive Measures (in the download) follow this month. Filter to one State to focus on it."
      >
        {attnMonths.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Month
            </span>
            <select
              value={attnMonth}
              onChange={(e) => onAttnMonth(e.target.value)}
              aria-label="Attention Required month"
              className={filterSelectCls}
            >
              {attnMonths.map((m) => (
                <option key={m} value={m}>{fmtYm(m)}</option>
              ))}
            </select>
          </div>
        )}
        <div className={`grid grid-cols-1 gap-4 ${attnStates.length > 1 ? "xl:grid-cols-2" : ""}`}>
          {attnStates.map((st) => (
            <TopFacilitiesChart key={st || "all"} result={result} state={st} limit={5} month={attnMonth} />
          ))}
        </div>
      </Section>

      {/* One chart, one series per state (MA/IL/DC). Filter to a State to hide others. */}
      <Section
        title="Year-over-Year Comparison"
        subtitle="Complaints per month, this year vs last year — one series per state (color = state, prior year dashed). Filter to one State to show only it."
      >
        <YearComparisonChart records={sourceYoyRecords} states={yoyStates} title="Complaints" />
      </Section>

      <Section
        title="Complaints by Month — Internal vs SpotHero"
        subtitle="Year-over-year by month, internal vs SpotHero — one series per state in each chart."
      >
        <ReportCharts records={sourceYoyRecords} states={yoyStates} />
      </Section>

      <Section
        title="Refunds by State"
        subtitle="Refund amount by month — one line per state — for the latest data year."
      >
        <RefundBySourceChart records={sourceYoyRecords} states={yoyStates} />
      </Section>

      <Section
        title="Complaint Rate vs Refund % of Net Remit"
        subtitle="Bars = complaint rate (% of reservations) · dashed lines = refund % of net remit · color = state · latest year."
      >
        <RateVsRefundChart detail={sourceDetail} states={yoyStates} />
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

      {/* Month-by-month detail per MA/IL/DC state + year (auto-hides other
          states when a state is selected). Action Plan & Preventive Measures
          live in the downloaded report only. */}
      <Section
        title="Detailed Monthly Data (MA / IL / DC)"
        subtitle="Month-by-month reservations, complaints (SpotHero vs Internal), rate, refunds and net remit — this year vs last year. Pick a State above to focus on one market."
      >
        <MonthlyDetailTables detail={sourceDetail} stateFilter={stateFilter} />
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
  const TOP_N = 20;
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
              <FTh>Year</FTh>
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
              const type = typeByFacility.get(`${f.facility}|${f.year}`) ?? "—";
              return (
                <tr
                  key={`${f.facility}|${f.year}`}
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
                  <FTd className="font-semibold text-slate-700 dark:text-slate-200">
                    {f.year || "—"}
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
                  colSpan={12}
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
      if (kind === "facility") rows = rows.slice(0, 20);
      out.push({ title, headers, rows });
    });
  return out;
}

function ExportMenu({
  result,
  dateRange,
  stateFilter,
  attnMonth,
  detailMonthly,
}: {
  result: ReportResult;
  dateRange: DateRange;
  stateFilter: string;
  attnMonth: string;
  detailMonthly: MonthlyDetail[];
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
      stateFilter,
      attnMonth,
      detailMonthly,
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
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-1 h-5 w-1.5 shrink-0 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          {subtitle && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/** A labeled control wrapper for the filter toolbar. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="pl-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      {children}
    </label>
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
