"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChartConfiguration } from "chart.js/auto";
import ChartCanvas from "@/components/shared/ChartCanvas";
import MultiFileUpload from "@/components/shared/MultiFileUpload";
import FacilityRecordsModal from "@/components/shared/FacilityRecordsModal";
import { useTheme } from "@/components/theme/ThemeProvider";
import { detectColumns, isAccountingReport } from "@/lib/reports/analyze";
import { categoryForReason } from "@/lib/reports/filters";
import { extractSpotHeroData } from "@/lib/reports/spotheroStore";
import { toIsoDate } from "@/lib/reports/columns";
import { printHtml, downloadHtml } from "@/lib/reportExport";
import type { ParsedCsv } from "@/types/data";
import type { ComplaintRecord, RawIncident, UploadLog, FacilityNote } from "@/lib/complaints/types";
import { MONTHS, biweeklyLabel } from "@/lib/complaints/period";
import { recommendFor } from "@/lib/complaints/recommendations";
import {
  applyFilters, tally, biweeklySeries, monthlySeries, yearlySeries, weeklySeries,
  facilityRollup, compare, seriesFor, actionImpact, clusterFacilities,
  type Filters, type SeriesPoint, type Gran, type FacilityRow,
} from "@/lib/complaints/aggregate";

const PAT_KEY = "airtablePat";
const NAME_KEY = "progressUserName";
const TABS = ["Dashboard", "Bi-Weekly", "Comparisons", "Facilities", "Ranking", "Priority", "Heat Map", "Summary", "History", "Upload", "Reports"] as const;
type Tab = (typeof TABS)[number];
const NOTE_CATEGORIES =["Updated Getting There Instructions", "Updated Facility Photos", "Added Signage", "Reduced Inventory", "Seller Training Conducted", "Gate Access Updated", "Contractor Work Completed", "Audit Completed", "Other"];

interface Data { complaints: ComplaintRecord[]; uploads: UploadLog[]; counts: { total: number; spotHero: number; internal: number }; internalError: string | null }

function extractIncidents(parsed: ParsedCsv): RawIncident[] {
  const cols = detectColumns(parsed.headers);
  const out: RawIncident[] = [];
  for (const row of parsed.rows) {
    const cat = categoryForReason(row[cols.reason] ?? "");
    if (cat !== "lot_full" && cat !== "inaccessibility") continue;
    const facility = (row[cols.spot] || row[cols.facility] || "").trim();
    if (!facility) continue;
    out.push({ facility, date: toIsoDate(row[cols.starts]) ?? "", rentalId: (row[cols.rentalId] ?? "").trim(), category: cat });
  }
  return out;
}

export default function FacilityProgressChecker() {
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const pat = typeof window !== "undefined" ? localStorage.getItem(PAT_KEY) : null;
    try {
      const res = await fetch("/api/complaint-history", { headers: pat ? { "x-airtable-pat": pat } : {} });
      const j = await res.json();
      if (!res.ok || !j?.ok) setError(j?.description || j?.error || "Could not load complaint history.");
      else setData(j as Data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const records = data?.complaints ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Facility Progress Checker</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Permanent complaint history with bi-weekly progress tracking — are complaint volumes going down over time?
            {data && <span className="ml-1 text-slate-400">· {data.counts.total} complaints ({data.counts.spotHero} SpotHero · {data.counts.internal} Internal)</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/complaint-history?export=csv" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Export history</a>
          <button type="button" onClick={load} disabled={loading} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700">{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </header>

      {data?.internalError && data.internalError !== "no_pat" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          {data.internalError.includes("403")
            ? "Internal complaints couldn’t sync — Airtable rejected your token (no access to the base). Go to Settings → recreate the token with the “data.records:read” scope and access to the base that holds CUSTOMER INTERACTIONS, save it, then Refresh. Showing SpotHero data only for now."
            : `Internal complaints could not sync from Airtable (${data.internalError}). Showing SpotHero data only.`}
        </p>
      )}
      {data?.internalError === "no_pat" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Add your Airtable token in Settings to sync internal complaints. Showing SpotHero uploads only.</p>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1 dark:border-slate-800 dark:bg-slate-800/40">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${tab === t ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading && !data && <p className="py-12 text-center text-sm text-slate-400">Loading complaint history…</p>}
      {data && (
        <>
          {tab === "Dashboard" && <Dashboard records={records} />}
          {tab === "Bi-Weekly" && <BiWeekly records={records} />}
          {tab === "Comparisons" && <Comparisons records={records} />}
          {tab === "Facilities" && <Facilities records={records} />}
          {tab === "Ranking" && <Ranking records={records} />}
          {tab === "Priority" && <Priority records={records} />}
          {tab === "Heat Map" && <HeatMap records={records} />}
          {tab === "Summary" && <Summary records={records} />}
          {tab === "History" && <History records={records} />}
          {tab === "Upload" && <Upload uploads={data.uploads} onUploaded={load} />}
          {tab === "Reports" && <Reports records={records} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------- Filters bar ------------------------------- */
function FiltersBar({ records, value, onChange }: { records: ComplaintRecord[]; value: Filters; onChange: (f: Filters) => void }) {
  const years = useMemo(() => [...new Set(records.map((r) => r.reportingYear))].sort((a, b) => b - a), [records]);
  const facilities = useMemo(() => [...new Set(records.map((r) => r.facilityName))].sort(), [records]);
  return (
    <div className="flex flex-wrap gap-2">
      <Sel v={value.year ? String(value.year) : ""} on={(x) => onChange({ ...value, year: x ? Number(x) : undefined })} opts={[["", "All years"], ...years.map((y) => [String(y), String(y)] as [string, string])]} />
      <Sel v={value.month ? String(value.month) : ""} on={(x) => onChange({ ...value, month: x ? Number(x) : undefined })} opts={[["", "All months"], ...MONTHS.map((m, i) => [String(i + 1), m] as [string, string])]} />
      <Sel v={value.type ?? ""} on={(x) => onChange({ ...value, type: (x || undefined) as Filters["type"] })} opts={[["", "All types"], ["lot_full", "Lot Full"], ["inaccessibility", "Inaccessibility"]]} />
      <Sel v={value.source ?? ""} on={(x) => onChange({ ...value, source: (x || undefined) as Filters["source"] })} opts={[["", "All sources"], ["SpotHero", "SpotHero"], ["Internal", "Internal"]]} />
      <Sel v={value.facility ?? ""} on={(x) => onChange({ ...value, facility: x || undefined })} opts={[["", "All facilities"], ...facilities.map((f) => [f, f] as [string, string])]} />
    </div>
  );
}


/* -------------------------------- Dashboard -------------------------------- */
function Dashboard({ records }: { records: ComplaintRecord[] }) {
  const [filters, setFilters] = useState<Filters>({});
  const rows = useMemo(() => applyFilters(records, filters), [records, filters]);
  const c = useMemo(() => tally(rows), [rows]);
  const facs = useMemo(() => facilityRollup(rows), [rows]);
  const top10 = useMemo(() => [...facs].sort((a, b) => b.counts.total - a.counts.total).slice(0, 10), [facs]);
  const improved = useMemo(() => facs.filter((f) => f.dir === "down").sort((a, b) => (a.current - a.previous) - (b.current - b.previous)).slice(0, 10), [facs]);
  const rising = useMemo(() => facs.filter((f) => f.dir === "up").sort((a, b) => (b.current - b.previous) - (a.current - a.previous)).slice(0, 10), [facs]);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRows = useMemo(() => {
    if (!picked) return [];
    return rows
      .filter((r) => r.facilityName === picked)
      .sort((a, b) => (b.complaintDate || "").localeCompare(a.complaintDate || ""))
      .map((r) => ({
        rentalId: r.rentalId,
        date: r.complaintDate,
        type: r.complaintType === "lot_full" ? "Lot Full" : "Inaccessibility",
        state: r.state || "",
        refund: r.amount ?? null,
      }));
  }, [picked, rows]);

  return (
    <div className="space-y-5">
      <FiltersBar records={records} value={filters} onChange={setFilters} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Total Complaints" value={c.total} tone="indigo" />
        <Stat label="SpotHero" value={c.spotHero} tone="blue" />
        <Stat label="Internal" value={c.internal} tone="purple" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Bi-Weekly Trend (primary KPI)"><TrendChart series={biweeklySeries(rows)} kind="bar" /></Card>
        <Card title="Monthly Trend"><TrendChart series={monthlySeries(rows)} kind="line" /></Card>
        <Card title="Weekly Trend"><TrendChart series={weeklySeries(rows)} kind="line" /></Card>
        <Card title="Yearly Trend"><TrendChart series={yearlySeries(rows)} kind="bar" /></Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Top 10 Facilities"><FacMini rows={top10} metric="total" onPick={setPicked} /></Card>
        <Card title="Most Improved"><FacMini rows={improved} metric="change" good onPick={setPicked} /></Card>
        <Card title="Increasing Complaints"><FacMini rows={rising} metric="change" onPick={setPicked} /></Card>
      </div>
      <InternalSources />
      {picked && <FacilityRecordsModal facility={picked} rows={pickedRows} onClose={() => setPicked(null)} />}
    </div>
  );
}

/* Per-Airtable-source breakdown of internal Lot Full / Inaccessibility cases. */
function InternalSources() {
  type Tally = { name: string; lotFull: number; inacc: number };
  const [sources, setSources] = useState<Tally[]>([]);
  useEffect(() => {
    const pat = typeof window !== "undefined" ? localStorage.getItem(PAT_KEY) : null;
    fetch("/api/internal-issues?category=all", { headers: pat ? { "x-airtable-pat": pat } : {} })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.records) return;
        const agg = new Map<string, Tally>();
        // Records are de-duplicated by Rental ID; attribute each RID to its
        // single primary table so a duplicate is never counted twice.
        for (const r of j.records as { category?: string; source?: string; origins?: string[] }[]) {
          const o = r.source || r.origins?.[0] || "Airtable";
          const e = agg.get(o) ?? { name: o, lotFull: 0, inacc: 0 };
          if (r.category === "lot_full") e.lotFull++;
          else if (r.category === "inaccessibility") e.inacc++;
          agg.set(o, e);
        }
        setSources([...agg.values()].sort((a, b) => b.lotFull + b.inacc - (a.lotFull + a.inacc)));
      })
      .catch(() => {});
  }, []);
  if (sources.length === 0) return null;
  return (
    <Card title="Internal Data Sources (Airtable)">
      <p className="mb-3 -mt-1 text-xs text-slate-500 dark:text-slate-400">Lot Full &amp; Inaccessibility cases gathered from each connected table.</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1.5 pr-3">Source table</th><th className="px-3 text-right">Lot Full</th><th className="px-3 text-right">Inaccessibility</th><th className="px-3 text-right">Total</th></tr></thead>
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
    </Card>
  );
}

function FacMini({ rows, metric, good, onPick }: { rows: FacilityRow[]; metric: "total" | "current" | "change"; good?: boolean; onPick?: (name: string) => void }) {
  if (rows.length === 0) return <Empty msg="No data." />;
  return (
    <ol className="space-y-1 text-sm">
      {rows.map((f, i) => (
        <li key={f.name} className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="w-4 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
            {onPick
              ? <button type="button" onClick={() => onPick(f.name)} className="truncate text-left font-medium text-indigo-600 hover:underline dark:text-indigo-400" title={`${f.name} — click for case details`}>{f.name}</button>
              : <span className="truncate text-slate-700 dark:text-slate-300" title={f.name}>{f.name}</span>}
          </span>
          {metric === "change"
            ? <span title={`${f.previous} → ${f.current} (${f.changePct >= 0 ? "+" : ""}${f.changePct}%)`} className={`shrink-0 font-semibold tabular-nums ${good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{f.dir === "down" ? "▼" : "▲"} {Math.abs(f.current - f.previous)} <span className="text-xs font-normal text-slate-400">({f.previous}→{f.current})</span></span>
            : <span className="shrink-0 font-semibold text-slate-800 dark:text-slate-100">{metric === "current" ? f.current : f.counts.total}</span>}
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------- Bi-Weekly -------------------------------- */
function BiWeekly({ records }: { records: ComplaintRecord[] }) {
  const series = useMemo(() => biweeklySeries(records), [records]);
  // Start unselected so the 2nd dropdown stays disabled until the 1st is picked.
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [shown, setShown] = useState<{ label: string; recs: ComplaintRecord[] } | null>(null);
  function pickA(v: string) { setA(v); if (v === b) setB(""); setShown(null); }
  function pickB(v: string) { setB(v); setShown(null); }
  const desc = useMemo(() => [...series].reverse(), [series]);
  const pa = series.find((s) => s.key === a);
  const pb = series.find((s) => s.key === b);
  const recA = useMemo(() => (a ? filterByKey(records, a) : []), [records, a]);
  const recB = useMemo(() => (b ? filterByKey(records, b) : []), [records, b]);
  const cmp = pa && pb ? compare(recB, recA) : null;

  // The records behind the change: cases added (in the later period, not the
  // earlier) for an increase, or resolved (in the earlier, not the later) for a
  // reduction — matched by Rental ID.
  const { delta, deltaLabel } = useMemo(() => {
    if (!cmp) return { delta: [] as ComplaintRecord[], deltaLabel: "" };
    const aIds = new Set(recA.map((r) => r.rentalId).filter(Boolean));
    const bIds = new Set(recB.map((r) => r.rentalId).filter(Boolean));
    if (cmp.dir === "up") return { delta: recB.filter((r) => !r.rentalId || !aIds.has(r.rentalId)), deltaLabel: "Increase — new cases" };
    if (cmp.dir === "down") return { delta: recA.filter((r) => !r.rentalId || !bIds.has(r.rentalId)), deltaLabel: "Reduction — resolved cases" };
    return { delta: [] as ComplaintRecord[], deltaLabel: "No change" };
  }, [cmp, recA, recB]);

  // Per-facility movement between the two periods.
  const facMove = useMemo(() => {
    if (!cmp) return [] as { facility: string; prev: number; cur: number; diff: number }[];
    const m = new Map<string, { prev: number; cur: number }>();
    for (const r of recA) { const e = m.get(r.facilityName) ?? { prev: 0, cur: 0 }; e.prev++; m.set(r.facilityName, e); }
    for (const r of recB) { const e = m.get(r.facilityName) ?? { prev: 0, cur: 0 }; e.cur++; m.set(r.facilityName, e); }
    return [...m.entries()].map(([facility, v]) => ({ facility, ...v, diff: v.cur - v.prev })).filter((x) => x.diff !== 0).sort((x, y) => y.diff - x.diff);
  }, [cmp, recA, recB]);

  const ridTitle = (recs: ComplaintRecord[]) => {
    const ids = recs.map((r) => r.rentalId || "(no RID)");
    return `Rental IDs (${ids.length}): ${ids.slice(0, 40).join(", ")}${ids.length > 40 ? `, …+${ids.length - 40} more` : ""}`;
  };

  return (
    <div className="space-y-5">
      <Card title="Bi-Weekly Comparison Engine">
        <p className="mb-3 -mt-1 text-xs text-slate-500 dark:text-slate-400">Compare any two bi-weekly periods. <b>Hover</b> a card to preview its Rental IDs; <b>click</b> to list them below.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Sel v={a} on={pickA} opts={[["", "Select first period…"], ...desc.map((s) => [s.key, s.range] as [string, string])]} />
          <span className="pb-2 text-slate-400">vs</span>
          <Sel v={b} on={pickB} disabled={!a} opts={[["", a ? "Select second period…" : "Pick the first period"], ...desc.filter((s) => s.key !== a).map((s) => [s.key, s.range] as [string, string])]} />
        </div>
        {cmp && pa && pb ? (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <CmpCard label={pa.range} sub="Earlier period" value={cmp.previous} title={ridTitle(recA)} onClick={() => setShown({ label: `${pa.range} · ${recA.length} cases`, recs: recA })} />
              <CmpCard label={pb.range} sub="Later period" value={cmp.current} title={ridTitle(recB)} onClick={() => setShown({ label: `${pb.range} · ${recB.length} cases`, recs: recB })} />
              <CmpCard label={cmp.dir === "down" ? "Reduced by" : cmp.dir === "up" ? "Increased by" : "No change"} sub={deltaLabel || "change"} value={Math.abs(cmp.diff)} tone={cmp.dir === "down" ? "good" : cmp.dir === "up" ? "bad" : undefined} arrow={cmp.dir} title={ridTitle(delta)} onClick={() => delta.length && setShown({ label: `${deltaLabel} · ${delta.length}`, recs: delta })} />
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-400">Select two periods to compare.</p>
        )}
      </Card>

      {cmp && facMove.length > 0 && (
        <Card title="Facility Movement (between the two periods)">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-2 pr-3">Facility</th><th className="px-2 text-right">Earlier</th><th className="px-2 text-right">Later</th><th className="px-2 text-right">Change</th></tr></thead>
              <tbody>
                {facMove.map((f) => {
                  const recs = [...recA, ...recB].filter((r) => r.facilityName === f.facility).sort((x, y) => (y.complaintDate || "").localeCompare(x.complaintDate || ""));
                  return (
                    <tr key={f.facility} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 pr-3">
                        <button type="button" onClick={() => setShown({ label: `${f.facility} · ${recs.length} case(s) in the compared periods`, recs })} className="text-left font-medium text-indigo-600 hover:underline dark:text-indigo-400" title={`${f.facility} — click for Rental IDs`}>{f.facility}</button>
                      </td>
                      <td className="px-2 text-right tabular-nums text-slate-500">{f.prev}</td>
                      <td className="px-2 text-right tabular-nums text-slate-500">{f.cur}</td>
                      <td className={`px-2 text-right font-semibold tabular-nums ${f.diff < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{f.diff < 0 ? `▼ ${Math.abs(f.diff)}` : `▲ ${f.diff}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {cmp && shown && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Rental IDs — {shown.label}</p>
            <button type="button" onClick={() => setShown(null)} className="text-xs font-medium text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">Close ✕</button>
          </div>
          <div className="max-h-[340px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-900"><tr className="text-left text-xs uppercase text-slate-400"><th className="px-3 py-2">Rental ID</th><th className="px-3">Date</th><th className="px-3">Facility</th><th className="px-3">Type</th></tr></thead>
              <tbody>
                {shown.recs.map((r, i) => (
                  <tr key={`${r.rentalId || "x"}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-1.5 font-medium text-slate-800 dark:text-slate-100">{r.rentalId || "—"}</td>
                    <td className="px-3 whitespace-nowrap text-slate-500">{r.complaintDate}</td>
                    <td className="max-w-[220px] truncate px-3 text-slate-600 dark:text-slate-300" title={r.facilityName}>{r.facilityName}</td>
                    <td className="px-3 whitespace-nowrap text-slate-500">{r.complaintType === "lot_full" ? "Lot Full" : "Inaccessibility"}</td>
                  </tr>
                ))}
                {shown.recs.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No rental IDs.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Clickable comparison card — hover shows Rental IDs (title), click lists them. */
function CmpCard({ label, sub, value, tone, arrow, title, onClick }: { label: string; sub?: string; value: number; tone?: "good" | "bad"; arrow?: "up" | "down" | "flat"; title?: string; onClick?: () => void }) {
  const color = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100";
  return (
    <button type="button" onClick={onClick} title={title} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{arrow === "down" ? "▼ " : arrow === "up" ? "▲ " : ""}{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </button>
  );
}
function filterByKey(records: ComplaintRecord[], biweeklyKeyStr: string): ComplaintRecord[] {
  const m = biweeklyKeyStr.match(/^(\d{4})-(\d{2}) P(\d)$/);
  if (!m) return [];
  const y = +m[1], mo = +m[2], bw = +m[3];
  return records.filter((r) => r.reportingYear === y && r.reportingMonth === mo && r.reportingBiweekly === bw);
}

/* ------------------------------- Comparisons ------------------------------- */
function Comparisons({ records }: { records: ComplaintRecord[] }) {
  const [gran, setGran] = useState<Gran>("weekly");
  const [type, setType] = useState<"" | "lot_full" | "inaccessibility">("");
  const typed = useMemo(() => applyFilters(records, { type: type || undefined }), [records, type]);
  const facs = useMemo(() => facilityRollup(typed, gran), [typed, gran]);

  const top10 = useMemo(() => [...facs].sort((a, b) => b.current - a.current || b.counts.total - a.counts.total).slice(0, 10), [facs]);
  const improved = useMemo(() => facs.filter((f) => f.dir === "down").sort((a, b) => (a.current - a.previous) - (b.current - b.previous)).slice(0, 10), [facs]);
  const rising = useMemo(() => facs.filter((f) => f.dir === "up").sort((a, b) => (b.current - b.previous) - (a.current - a.previous)).slice(0, 10), [facs]);

  const granLabel = { weekly: "Weekly", biweekly: "Bi-Weekly", monthly: "Monthly", yearly: "Yearly" }[gran];
  const typeLabel = type === "lot_full" ? "Lot Full" : type === "inaccessibility" ? "Inaccessibility" : "";
  const title = `Top 10 ${granLabel} ${typeLabel} Facilities`.replace(/\s+/g, " ").trim();
  const cards: { id: Gran; label: string }[] = [
    { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Show:</span>
        <Sel v={type} on={(x) => setType(x as typeof type)} opts={[["", "All complaints"], ["lot_full", "Lot Full"], ["inaccessibility", "Inaccessibility"]]} />
        <span className="text-xs text-slate-400">Click a period below to drive the facility tables.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <CompareCard key={c.id} label={c.label} records={typed} gran={c.id} active={gran === c.id} onClick={() => setGran(c.id)} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={title}><FacMini rows={top10} metric="current" /></Card>
        <Card title={`Most Improved (${granLabel})`}><FacMini rows={improved} metric="change" good /></Card>
        <Card title={`Increasing Complaints (${granLabel})`}><FacMini rows={rising} metric="change" /></Card>
      </div>
    </div>
  );
}

function CompareCard({ label, records, gran, active, onClick }: { label: string; records: ComplaintRecord[]; gran: Gran; active: boolean; onClick: () => void }) {
  const s = seriesFor(records, gran);
  const cur = s[s.length - 1], prev = s[s.length - 2];
  const cmp = compare(new Array(cur?.counts.total ?? 0).fill(0) as ComplaintRecord[], new Array(prev?.counts.total ?? 0).fill(0) as ComplaintRecord[]);
  return (
    <button type="button" onClick={onClick}
      className={`rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:shadow dark:bg-slate-900 ${active ? "border-indigo-400 ring-2 ring-indigo-100 dark:border-indigo-500 dark:ring-indigo-500/30" : "border-slate-200 dark:border-slate-800"}`}>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label} <span className="font-normal text-slate-400">(current vs previous)</span></p>
      {cur ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Mini label={prev?.range ?? "—"} value={prev?.counts.total ?? 0} />
          <Mini label={cur.range} value={cur.counts.total} />
          <Mini label={cmp.dir === "down" ? "Fewer cases" : cmp.dir === "up" ? "More cases" : "No change"} value={Math.abs(cmp.diff)} tone={cmp.dir === "down" ? "good" : cmp.dir === "up" ? "bad" : undefined} arrow={cmp.dir} />
        </div>
      ) : <Empty msg="No data." />}
      <p className={`mt-2 text-xs font-medium ${active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400"}`}>{active ? "● showing below" : "Click to view"}</p>
    </button>
  );
}

/* --------------------------------- Ranking --------------------------------- */
function RankChart({ rows, maxRank }: { rows: { label: string; rank: number | null; total: number }[]; maxRank: number }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  const config = useMemo<ChartConfiguration>(() => ({
    type: "bar",
    data: {
      labels: rows.map((r) => r.label),
      datasets: [
        { type: "line", label: "Rank", data: rows.map((r) => r.rank), yAxisID: "rank", borderColor: "#6366f1", backgroundColor: "#6366f1", tension: 0.35, spanGaps: true, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2, order: 0 },
        { type: "bar", label: "Complaints", data: rows.map((r) => r.total), yAxisID: "vol", backgroundColor: dark ? "rgba(168,85,247,0.35)" : "rgba(168,85,247,0.28)", borderColor: "#a855f7", borderWidth: 1, order: 1, maxBarThickness: 42 },
      ] as ChartConfiguration["data"]["datasets"],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: text, boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: text, font: { size: 10 } }, grid: { display: false } },
        rank: { position: "left", reverse: true, min: 1, max: maxRank, ticks: { color: "#6366f1", precision: 0, stepSize: 1, callback: (v: string | number) => `#${v}` }, grid: { color: grid }, title: { display: true, text: "Rank (#1 = most complaints)", color: text, font: { size: 10 } } },
        vol: { position: "right", beginAtZero: true, ticks: { color: "#a855f7", precision: 0 }, grid: { display: false }, title: { display: true, text: "Complaints", color: text, font: { size: 10 } } },
      },
    },
  }), [rows, text, grid, dark, maxRank]);
  if (rows.length === 0) return <Empty msg="No data." />;
  return <ChartCanvas height={300} config={config} />;
}

function Ranking({ records }: { records: ComplaintRecord[] }) {
  // Merge near-duplicate facility names (≥90% similar) into one canonical name.
  // `repOf` maps every raw name → its representative; the dropdown and the
  // ranking counts both use the representative so a facility never appears twice.
  const { repOf, facilityNames } = useMemo(() => {
    const freq = new Map<string, number>();
    for (const r of records) freq.set(r.facilityName, (freq.get(r.facilityName) ?? 0) + 1);
    const ordered = [...freq.keys()].sort((a, b) => (freq.get(b)! - freq.get(a)!) || a.localeCompare(b));
    const { repOf } = clusterFacilities(ordered);
    return { repOf, facilityNames: [...new Set([...repOf.values()])].sort((a, b) => a.localeCompare(b)) };
  }, [records]);
  const [rankFac, setRankFac] = useState("");
  useEffect(() => { if (facilityNames.length && !rankFac) setRankFac(facilityNames[0]); }, [facilityNames, rankFac]);

  // Total facilities ranked each month (for the chart axis ceiling).
  const totalFacilities = facilityNames.length || 2;
  const rankRows = useMemo(() => {
    if (!rankFac) return [] as { label: string; rank: number | null; total: number }[];
    return monthlySeries(records).map((s) => {
      const [y, m] = s.key.split("-").map(Number);
      const counts = new Map<string, number>();
      for (const r of records) if (r.reportingYear === y && r.reportingMonth === m) {
        const rep = repOf.get(r.facilityName) ?? r.facilityName;
        counts.set(rep, (counts.get(rep) ?? 0) + 1);
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const idx = sorted.findIndex(([n]) => n === rankFac);
      return { label: s.label, rank: idx >= 0 ? idx + 1 : null, total: idx >= 0 ? sorted[idx][1] : 0 };
    });
  }, [records, rankFac, repOf]);

  const ranked = useMemo(() => rankRows.filter((r) => r.rank != null) as { label: string; rank: number; total: number }[], [rankRows]);
  const current = ranked.length ? ranked[ranked.length - 1] : null;
  const peak = ranked.length ? ranked.reduce((a, b) => (b.rank < a.rank ? b : a)) : null; // closest to #1
  const net = ranked.length >= 2 ? ranked[ranked.length - 1].rank - ranked[0].rank : 0; // >0 = fell down leaderboard = improved
  const maxRank = Math.max(2, ...ranked.map((r) => r.rank));

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500 dark:text-slate-400">How a facility&apos;s complaint ranking moves over time. <b>Rank #1 = the most complaints that month</b> — so <span className="text-emerald-600 dark:text-emerald-400">falling in rank (fewer complaints) is an improvement</span>. Near-duplicate facility names are merged automatically.</p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Facility:</span>
        <Sel v={rankFac} on={setRankFac} opts={facilityNames.map((f) => [f, f] as [string, string])} className="min-w-[260px] max-w-md" />
      </div>

      {ranked.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Current rank</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">#{current!.rank}<span className="ml-1 text-sm font-normal text-slate-400">of {totalFacilities}</span></p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Peak severity</p>
            <p className="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400">#{peak!.rank}<span className="ml-1 text-sm font-normal text-slate-400">{peak!.label}</span></p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Complaints (latest)</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{current!.total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Net movement</p>
            <p className={`mt-1 text-2xl font-bold ${net > 0 ? "text-emerald-600 dark:text-emerald-400" : net < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400"}`}>{net === 0 ? "—" : net > 0 ? `▼ ${net} better` : `▲ ${Math.abs(net)} worse`}</p>
          </div>
        </div>
      )}

      <Card title="Rank Trajectory">
        <RankChart rows={rankRows} maxRank={maxRank} />
        <p className="mt-2 text-xs text-slate-400">The rank line is drawn on a reversed axis (#1 at the top), so a line trending <b>downward</b> means the facility is moving down the most-complaints leaderboard — an improvement. Bars show raw complaint volume.</p>
      </Card>

      <Card title="Month-by-Month Detail">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1.5 pr-2">Month</th><th className="px-2 text-right">Rank</th><th className="px-2 text-right">Complaints</th><th className="px-2 text-right">Movement</th></tr></thead>
            <tbody>
              {rankRows.map((row, i) => {
                const prev = rankRows[i - 1];
                const mv = prev?.rank != null && row.rank != null ? row.rank - prev.rank : null; // >0 = fell = improved
                return (
                  <tr key={row.label} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{row.label}</td>
                    <td className="px-2 text-right tabular-nums">{row.rank != null ? `#${row.rank}` : "—"}</td>
                    <td className="px-2 text-right tabular-nums text-slate-500">{row.total}</td>
                    <td className={`px-2 text-right tabular-nums ${mv == null || mv === 0 ? "text-slate-400" : mv > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {mv == null ? "—" : mv === 0 ? "—" : mv > 0 ? `▼ ${mv} better` : `▲ ${Math.abs(mv)} worse`}
                    </td>
                  </tr>
                );
              })}
              {rankRows.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-400">No data.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------- History --------------------------------- */
function History({ records }: { records: ComplaintRecord[] }) {
  const years = useMemo(() => [...new Set(records.map((r) => r.reportingYear))].sort((a, b) => b - a), [records]);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  useEffect(() => { if (years.length && year === null) setYear(years[0]); }, [years, year]);

  const monthRecords = useMemo(() => records.filter((r) => r.reportingYear === year && r.reportingMonth === month), [records, year, month]);
  const c = tally(monthRecords);
  const topFac = facilityRollup(monthRecords).sort((a, b) => b.counts.total - a.counts.total).slice(0, 10);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="History">
        {years.map((y) => (
          <div key={y} className="mb-2">
            <button type="button" onClick={() => { setYear(y); setMonth(null); }} className={`text-sm font-semibold ${year === y ? "text-indigo-600 dark:text-indigo-400" : "text-slate-700 dark:text-slate-200"}`}>{y}</button>
            {year === y && (
              <ul className="ml-3 mt-1 space-y-0.5">
                {MONTHS.map((mLabel, i) => {
                  const n = records.filter((r) => r.reportingYear === y && r.reportingMonth === i + 1).length;
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => setMonth(i + 1)} className={`flex w-full justify-between rounded px-2 py-0.5 text-sm ${month === i + 1 ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"}`}>
                        <span>{mLabel}</span><span className="tabular-nums text-slate-400">{n || ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </Card>
      <div className="lg:col-span-2">
        <Card title={month ? `${MONTHS[month - 1]} ${year}` : "Select a month"}>
          {month ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Mini label="Total" value={c.total} />
                <Mini label="SpotHero" value={c.spotHero} />
                <Mini label="Internal" value={c.internal} />
                <Mini label="Lot Full" value={c.lotFull} />
                <Mini label="Inaccessibility" value={c.inaccessibility} />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Top Facilities</p>
                <FacMini rows={topFac} metric="total" />
              </div>
            </div>
          ) : <Empty msg="Pick a month from the History tree." />}
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------- Facilities ------------------------------- */
function Facilities({ records }: { records: ComplaintRecord[] }) {
  const facs = useMemo(() => facilityRollup(records), [records]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"highest" | "improved" | "growing" | "name">("highest");
  const [sel, setSel] = useState<string | null>(null);

  const rows = useMemo(() => {
    let r = facs.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
    if (sort === "highest") r = [...r].sort((a, b) => b.counts.total - a.counts.total);
    else if (sort === "improved") r = [...r].filter((f) => f.dir === "down").sort((a, b) => a.changePct - b.changePct);
    else if (sort === "growing") r = [...r].filter((f) => f.dir === "up").sort((a, b) => b.changePct - a.changePct);
    else r = [...r].sort((a, b) => a.name.localeCompare(b.name));
    return r;
  }, [facs, q, sort]);

  if (sel) return <FacilityDetail records={records} name={sel} onBack={() => setSel(null)} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search facilities…" className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
        <Sel v={sort} on={(x) => setSort(x as typeof sort)} opts={[["highest", "Highest complaints"], ["improved", "Most improved"], ["growing", "Fastest growing"], ["name", "Facility name"]]} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-400 dark:bg-slate-800/60"><th className="px-4 py-2.5">Facility</th><th className="px-3 text-right">Total</th><th className="px-3 text-right">Lot Full</th><th className="px-3 text-right">Inacc.</th><th className="px-3 text-right">Trend</th></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.name} onClick={() => setSel(f.name)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">{f.name}</td>
                <td className="px-3 text-right tabular-nums">{f.counts.total}</td>
                <td className="px-3 text-right tabular-nums">{f.counts.lotFull}</td>
                <td className="px-3 text-right tabular-nums">{f.counts.inaccessibility}</td>
                <td className={`px-3 text-right tabular-nums ${f.dir === "down" ? "text-emerald-600" : f.dir === "up" ? "text-rose-600" : "text-slate-400"}`} title={`${f.previous} → ${f.current} vs previous bi-weekly`}>{f.dir === "down" ? "▼" : f.dir === "up" ? "▲" : "—"}{f.dir !== "flat" ? ` ${Math.abs(f.current - f.previous)}` : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No facilities match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FacilityDetail({ records, name, onBack }: { records: ComplaintRecord[]; name: string; onBack: () => void }) {
  const recs = useMemo(() => records.filter((r) => r.facilityName === name), [records, name]);
  const c = tally(recs);
  const trendUp = facilityRollup(recs, "biweekly")[0]?.dir === "up";
  const rec = recommendFor({ name, lotFull: c.lotFull, inaccessibility: c.inaccessibility, trendUp });
  const [notes, setNotes] = useState<FacilityNote[]>([]);
  const [form, setForm] = useState({ category: "Updated Getting There Instructions", note: "", dateImplemented: "" });
  // Per-facility comparison controls (same idea as the Comparisons tab).
  const [gran, setGran] = useState<Gran>("weekly");
  const [type, setType] = useState<"" | "lot_full" | "inaccessibility">("");
  const typed = useMemo(() => applyFilters(recs, { type: type || undefined }), [recs, type]);
  const granLabel = { weekly: "Weekly", biweekly: "Bi-Weekly", monthly: "Monthly", yearly: "Yearly" }[gran];

  async function refresh() { const j = await (await fetch("/api/complaint-notes")).json(); if (j?.ok) setNotes((j.notes as FacilityNote[]).filter((n) => n.facilityName === name)); }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [name]);
  async function addNote() {
    if (!form.note.trim()) return;
    const author = (typeof window !== "undefined" && localStorage.getItem(NAME_KEY)) || "Unknown";
    await fetch("/api/complaint-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facilityName: name, category: form.category, note: form.note, author, dateImplemented: form.dateImplemented }) });
    setForm({ category: "Updated Getting There Instructions", note: "", dateImplemented: "" }); refresh();
  }

  // Chronological monthly history (for the Improvement Timeline).
  const timeline = useMemo(() => monthlySeries(recs), [recs]);
  const overallReduction = timeline.length >= 2 ? timeline[0].counts.total - timeline[timeline.length - 1].counts.total : 0;
  const maxMonth = Math.max(1, ...timeline.map((t) => t.counts.total));
  const actionsByMonth = useMemo(() => {
    const m = new Map<string, FacilityNote[]>();
    for (const n of notes) {
      if (!n.dateImplemented) continue;
      const k = n.dateImplemented.slice(0, 7); // YYYY-MM
      (m.get(k) ?? m.set(k, []).get(k)!).push(n);
    }
    return m;
  }, [notes]);

  // Inline editing of an existing note.
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ category: "", note: "", dateImplemented: "" });
  function startEdit(n: FacilityNote) {
    setEditId(n.id);
    setEditForm({ category: n.category, note: n.note, dateImplemented: n.dateImplemented || "" });
  }
  async function saveEdit() {
    if (!editId || !editForm.note.trim()) return;
    await fetch("/api/complaint-notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editId, ...editForm }) });
    setEditId(null); refresh();
  }
  async function deleteNote(id: string) {
    await fetch(`/api/complaint-notes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (editId === id) setEditId(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400">← Back to facilities</button>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{name}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Mini label="Total" value={c.total} />
        <Mini label="SpotHero" value={c.spotHero} />
        <Mini label="Internal" value={c.internal} />
        <Mini label="Lot Full" value={c.lotFull} />
        <Mini label="Inaccessibility" value={c.inaccessibility} />
      </div>

      <Card title="Trend & Comparison">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Show:</span>
          <Sel v={type} on={(x) => setType(x as typeof type)} opts={[["", "All complaints"], ["lot_full", "Lot Full"], ["inaccessibility", "Inaccessibility"]]} />
          <span className="text-xs text-slate-400">Click a period to drive the chart below.</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["weekly", "monthly", "yearly"] as const).map((g) => (
            <CompareCard key={g} label={{ weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[g]} records={typed} gran={g} active={gran === g} onClick={() => setGran(g)} />
          ))}
        </div>
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{granLabel} trend</p>
          <TrendChart series={seriesFor(typed, gran)} kind="bar" />
        </div>
      </Card>
      <Card title="Recommendations">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold text-white ${rec.priority === "High" ? "bg-rose-500" : rec.priority === "Medium" ? "bg-amber-500" : "bg-slate-400"}`}>{rec.priority} priority</span>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">Focus: {rec.focus}</span>
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-300">{rec.summary}</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Likely root causes</p>
            <ul className="list-inside list-disc space-y-0.5 text-sm text-slate-600 dark:text-slate-300">{rec.rootCauses.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Recommended actions</p>
            <ul className="list-inside list-disc space-y-0.5 text-sm text-slate-600 dark:text-slate-300">{rec.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        </div>
        <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">{rec.expectedImpact}</p>
      </Card>
      <Card title="Action Plan">
        <div className="grid gap-3 sm:grid-cols-3">
          {rec.actionPlan.map((p, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{p.phase}</p>
              <p className="mt-0.5 text-xs text-slate-400">Owner: {p.owner} · Due {p.dueInDays}d</p>
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-slate-600 dark:text-slate-300">{p.actions.map((a, j) => <li key={j}>{a}</li>)}</ul>
              <p className="mt-2 text-xs italic text-emerald-600 dark:text-emerald-400">→ {p.expectedOutcome}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Improvement Timeline">
        {timeline.length === 0 ? <Empty msg="No history yet." /> : (
          <>
            {overallReduction !== 0 && (
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                Overall: <b className={overallReduction > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{overallReduction > 0 ? "▼" : "▲"} {Math.abs(overallReduction)} {overallReduction > 0 ? "fewer" : "more"}</b> complaints from {timeline[0].label} to {timeline[timeline.length - 1].label}.
              </p>
            )}
            <ul className="space-y-1.5">
              {timeline.map((t) => (
                <li key={t.key} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs text-slate-500">{t.label}</span>
                  <span className="h-4 shrink-0 rounded bg-indigo-500" style={{ width: `${Math.max(6, (t.counts.total / maxMonth) * 180)}px` }} />
                  <span className="shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">{t.counts.total}</span>
                  {(actionsByMonth.get(t.key) ?? []).map((a, i) => (
                    <span key={i} title={a.note} className="truncate rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">⚑ {a.category}</span>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Manual Notes & Actions">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Sel v={form.category} on={(x) => setForm((f) => ({ ...f, category: x }))} opts={NOTE_CATEGORIES.map((c) => [c, c] as [string, string])} />
          <input type="date" value={form.dateImplemented} onChange={(e) => setForm((f) => ({ ...f, dateImplemented: e.target.value }))} title="Date implemented" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
          <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Details / note…" className="min-w-[180px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
          <button type="button" onClick={addNote} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Add</button>
        </div>
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800">
              {editId === n.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Sel v={editForm.category} on={(x) => setEditForm((f) => ({ ...f, category: x }))} opts={NOTE_CATEGORIES.map((c) => [c, c] as [string, string])} />
                  <input type="date" value={editForm.dateImplemented} onChange={(e) => setEditForm((f) => ({ ...f, dateImplemented: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
                  <input value={editForm.note} onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))} className="min-w-[180px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
                  <button type="button" onClick={saveEdit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Save</button>
                  <button type="button" onClick={() => setEditId(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Cancel</button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-slate-700 dark:text-slate-200">{n.note}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{n.category} · {n.author} · added {n.dateCreated}{n.dateImplemented ? ` · implemented ${n.dateImplemented}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => startEdit(n)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Edit</button>
                    <button type="button" onClick={() => deleteNote(n.id)} className="text-xs font-medium text-rose-500 hover:underline">Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {notes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
        </ul>
      </Card>
    </div>
  );
}

/* ----------------------------- Phase 3 helpers ----------------------------- */
const DAY = 86_400_000;

/* ----------------------------- Priority Index ------------------------------ */
type PriorityCat = "Critical" | "High" | "Medium" | "Low";
const PRIORITY_COLOR: Record<PriorityCat, string> = { Critical: "#e11d48", High: "#f59e0b", Medium: "#3b82f6", Low: "#10b981" };

function Priority({ records }: { records: ComplaintRecord[] }) {
  const now = Date.now();
  const [filter, setFilter] = useState<"all" | PriorityCat>("all");
  const rows = useMemo(() => {
    const map = new Map<string, ComplaintRecord[]>();
    for (const r of records) (map.get(r.facilityName) ?? map.set(r.facilityName, []).get(r.facilityName)!).push(r);
    const out = [...map.entries()].map(([facility, recs]) => {
      const age = (r: ComplaintRecord) => now - new Date(r.complaintDate).getTime();
      const last30 = recs.filter((r) => age(r) <= 30 * DAY).length;
      const prev30 = recs.filter((r) => { const d = age(r); return d > 30 * DAY && d <= 60 * DAY; }).length;
      const last90 = recs.filter((r) => age(r) <= 90 * DAY).length;
      const total = recs.length;
      const growth = last30 - prev30;
      const open = recs.filter((r) => r.resolutionStatus !== "Closed").length;
      const times = recs.map((r) => new Date(r.complaintDate).getTime()).filter((t) => !isNaN(t));
      const sinceLast = times.length ? Math.floor((now - Math.max(...times)) / DAY) : 999;
      // Transparent weighted index (0–100): recent volume + growth + recency + open load.
      const volScore = Math.min(45, last90 * 1.5);
      const growthScore = Math.min(25, Math.max(0, growth) * 4);
      const recencyScore = sinceLast <= 14 ? 20 : sinceLast <= 30 ? 10 : 0;
      const openScore = Math.min(10, open * 0.4);
      const score = Math.round(volScore + growthScore + recencyScore + openScore);
      const cat: PriorityCat = score >= 70 ? "Critical" : score >= 45 ? "High" : score >= 20 ? "Medium" : "Low";
      return { facility, last30, prev30, last90, total, growth, open, sinceLast, score, cat };
    });
    return out.sort((a, b) => b.score - a.score);
  }, [records, now]);

  const counts = useMemo(() => { const o: Record<PriorityCat, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 }; for (const r of rows) o[r.cat]++; return o; }, [rows]);
  const shown = rows.filter((r) => filter === "all" || r.cat === filter);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">Where to focus first. The Priority Index combines recent complaint volume (90d), growth (30d vs prior 30d), recency, and open load into one 0–100 score — no health score, just urgency.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["Critical", "High", "Medium", "Low"] as PriorityCat[]).map((c) => (
          <button key={c} type="button" onClick={() => setFilter(filter === c ? "all" : c)} className={`rounded-xl border px-4 py-3 text-left shadow-sm transition-all ${filter === c ? "ring-2 ring-offset-1 dark:ring-offset-slate-900" : ""} border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900`} style={filter === c ? { boxShadow: `0 0 0 2px ${PRIORITY_COLOR[c]}` } : undefined}>
            <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: PRIORITY_COLOR[c] }}>{c}</span>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{counts[c]}</p>
          </button>
        ))}
      </div>
      <Card title={filter === "all" ? "Facilities Requiring Immediate Attention" : `${filter} priority facilities`}>
        {shown.length === 0 ? <Empty msg="No facilities in this band." /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-400"><Th>Facility</Th><Th right>Index</Th><Th>Priority</Th><Th right>Last 30d</Th><Th right>Growth</Th><Th right>Last 90d</Th><Th right>Open</Th><Th right>Days since last</Th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.facility} className="border-t border-slate-100 dark:border-slate-800">
                    <Td className="font-medium text-slate-800 dark:text-slate-100">{r.facility}</Td>
                    <Td right><span className="inline-block min-w-[2.5rem] rounded-full px-2 py-0.5 text-center text-xs font-bold text-white" style={{ background: PRIORITY_COLOR[r.cat] }}>{r.score}</span></Td>
                    <Td><span className="text-xs font-semibold" style={{ color: PRIORITY_COLOR[r.cat] }}>{r.cat}</span></Td>
                    <Td right className="font-semibold">{r.last30}</Td>
                    <Td right className={r.growth > 0 ? "text-rose-600 dark:text-rose-400" : r.growth < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}>{r.growth > 0 ? `▲ ${r.growth}` : r.growth < 0 ? `▼ ${-r.growth}` : "—"}</Td>
                    <Td right className="text-slate-500">{r.last90}</Td>
                    <Td right className="text-slate-500">{r.open}</Td>
                    <Td right className="text-slate-500">{r.sinceLast === 999 ? "—" : r.sinceLast}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------- Heat Map ---------------------------------- */
function HeatMap({ records }: { records: ComplaintRecord[] }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [gran, setGran] = useState<Gran>("monthly");
  const [filters, setFilters] = useState<Filters>({});
  const filtered = useMemo(() => applyFilters(records, filters), [records, filters]);
  const periods = useMemo(() => seriesFor(filtered, gran).slice(-24), [filtered, gran]);
  const facs = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of filtered) totals.set(r.facilityName, (totals.get(r.facilityName) ?? 0) + 1);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([f]) => f);
  }, [filtered]);
  const grid = useMemo(() => {
    const keys = periods.map((p) => p.key);
    return facs.map((f) => {
      const fs = seriesFor(filtered.filter((r) => r.facilityName === f), gran);
      const m = new Map(fs.map((p) => [p.key, p.counts.total] as const));
      return { facility: f, cells: keys.map((k) => m.get(k) ?? 0) };
    });
  }, [facs, periods, filtered, gran]);
  const max = Math.max(1, ...grid.flatMap((g) => g.cells));

  function cellStyle(v: number): React.CSSProperties {
    if (v === 0) return { background: dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.10)", color: dark ? "#475569" : "#94a3b8" };
    const t = v / max; // 0..1
    const hue = 120 - 120 * t; // green→red
    return { background: `hsl(${hue}, 75%, ${dark ? 32 : 55}%)`, color: t > 0.45 ? "#fff" : dark ? "#e2e8f0" : "#1e293b" };
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">Complaint intensity by facility and period — spot hot streaks at a glance. Showing the top {facs.length} facilities by volume, most recent {periods.length} periods.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Sel v={gran} on={(x) => setGran(x as Gran)} opts={[["weekly", "Weekly"], ["biweekly", "Bi-Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]]} />
        <FiltersBar records={records} value={filters} onChange={setFilters} />
      </div>
      <Card title="Complaint Heat Map">
        {grid.length === 0 || periods.length === 0 ? <Empty msg="No data for this view." /> : (
          <div className="overflow-x-auto">
            <table className="border-separate" style={{ borderSpacing: "2px" }}>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left text-xs font-semibold text-slate-400 dark:bg-slate-900">Facility</th>
                  {periods.map((p) => <th key={p.key} className="px-1 py-1 text-center text-[10px] font-medium text-slate-400" title={p.label}>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.facility}>
                    <td className="sticky left-0 z-10 max-w-[200px] truncate bg-white px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-900 dark:text-slate-200" title={row.facility}>{row.facility}</td>
                    {row.cells.map((v, i) => (
                      <td key={i} className="h-7 w-10 rounded text-center text-[11px] font-semibold tabular-nums" style={cellStyle(v)} title={`${row.facility} · ${periods[i].label}: ${v}`}>{v || ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <span>Low</span>
          <span className="h-3 w-6 rounded" style={{ background: `hsl(120,75%,${dark ? 32 : 55}%)` }} />
          <span className="h-3 w-6 rounded" style={{ background: `hsl(60,75%,${dark ? 32 : 55}%)` }} />
          <span className="h-3 w-6 rounded" style={{ background: `hsl(0,75%,${dark ? 32 : 55}%)` }} />
          <span>High ({max})</span>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------- Executive Summary generator ----------------------- */
interface SummaryData {
  periodLabel: string;
  total: number;
  prevTotal: number;
  reductionPct: number; // >0 = reduction
  lotFull: number;
  inacc: number;
  mostImproved: { facility: string; prev: number; cur: number; diff: number }[];
  highestRisk: { facility: string; cur: number; growth: number; score: number }[];
  rootCauses: { cause: string; count: number }[];
  actionImpact: { cat: string; avgRed: number; facsImproved: number }[];
  recommendations: string[];
  narrative: string[];
  facilitiesActive: number;
}

function buildSummary(records: ComplaintRecord[], notes: FacilityNote[], key: string): SummaryData | null {
  const months = monthlySeries(records);
  if (months.length === 0) return null;
  const idx = Math.max(0, months.findIndex((m) => m.key === key));
  const cur = months[idx];
  const prev = months[idx - 1];
  const [cy, cm] = cur.key.split("-").map(Number);

  const facMap = (y: number, m: number) => {
    const map = new Map<string, number>();
    for (const r of records) if (r.reportingYear === y && r.reportingMonth === m) map.set(r.facilityName, (map.get(r.facilityName) ?? 0) + 1);
    return map;
  };
  const curMap = facMap(cy, cm);
  const prevMap = prev ? facMap(...prev.key.split("-").map(Number) as [number, number]) : new Map<string, number>();

  const total = cur.counts.total;
  const prevTotal = prev?.counts.total ?? 0;
  const reductionPct = prevTotal > 0 ? Math.round(((prevTotal - total) / prevTotal) * 100) : 0;

  const facUnion = new Set([...curMap.keys(), ...prevMap.keys()]);
  const mostImproved = [...facUnion].map((f) => ({ facility: f, prev: prevMap.get(f) ?? 0, cur: curMap.get(f) ?? 0 }))
    .map((x) => ({ ...x, diff: x.prev - x.cur })).filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const highestRisk = [...curMap.entries()].map(([facility, c]) => { const growth = c - (prevMap.get(facility) ?? 0); return { facility, cur: c, growth, score: c * 2 + Math.max(0, growth) * 3 }; })
    .sort((a, b) => b.score - a.score).slice(0, 5);

  const rcMap = new Map<string, number>();
  for (const r of records) if (r.reportingYear === cy && r.reportingMonth === cm && r.rootCause) rcMap.set(r.rootCause, (rcMap.get(r.rootCause) ?? 0) + 1);
  const rootCauses = [...rcMap.entries()].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count).slice(0, 5);

  // Corrective action impact (proven library, across all logged actions).
  const impMap = new Map<string, { used: number; redSum: number; facs: Set<string> }>();
  for (const n of notes) {
    if (!n.dateImplemented) continue;
    const imp = actionImpact(records, n.facilityName, n.dateImplemented);
    if (!imp) continue;
    const e = impMap.get(n.category) ?? { used: 0, redSum: 0, facs: new Set<string>() };
    e.used++; e.redSum += imp.before > 0 ? Math.round(((imp.before - imp.after) / imp.before) * 100) : 0;
    if (imp.diff < 0) e.facs.add(n.facilityName);
    impMap.set(n.category, e);
  }
  const impact = [...impMap.entries()].map(([cat, e]) => ({ cat, avgRed: Math.round(e.redSum / e.used), facsImproved: e.facs.size })).filter((x) => x.avgRed > 0).sort((a, b) => b.avgRed - a.avgRed);

  const domType = (f: string) => {
    const rs = records.filter((r) => r.facilityName === f);
    return rs.filter((r) => r.complaintType === "inaccessibility").length >= rs.filter((r) => r.complaintType === "lot_full").length ? "inaccessibility" : "lot_full";
  };
  const ACTION_FOR: Record<string, string> = { inaccessibility: "refresh Getting There instructions, photos and signage", lot_full: "review inventory configuration and seller oversold settings" };
  const recommendations: string[] = [];
  for (const r of highestRisk.slice(0, 3)) recommendations.push(`${r.facility}: ${ACTION_FOR[domType(r.facility)]} — ${domType(r.facility) === "lot_full" ? "Lot Full" : "Inaccessibility"} is the primary driver (${r.cur} complaints${r.growth > 0 ? `, up ${r.growth} vs prior month` : ""}).`);
  if (impact[0]) recommendations.push(`Scale “${impact[0].cat}” across at-risk facilities — it has cut complaints ~${impact[0].avgRed}% where applied (${impact[0].facsImproved} facilities improved).`);
  if (mostImproved[0]) recommendations.push(`Document and replicate what worked at ${mostImproved[0].facility} (${mostImproved[0].diff} fewer complaints this period).`);

  const lotFull = records.filter((r) => r.reportingYear === cy && r.reportingMonth === cm && r.complaintType === "lot_full").length;
  const inacc = total - lotFull;

  const narrative: string[] = [];
  narrative.push(`In ${cur.label}, the portfolio recorded ${total} parking complaint${total === 1 ? "" : "s"} across ${curMap.size} active facilit${curMap.size === 1 ? "y" : "ies"}` +
    (prev ? `, ${reductionPct > 0 ? `a ${reductionPct}% reduction` : reductionPct < 0 ? `a ${Math.abs(reductionPct)}% increase` : "flat"} versus ${prev.label} (${prevTotal}).` : "."));
  narrative.push(`Complaints split into ${lotFull} Lot Full (${total ? Math.round((lotFull / total) * 100) : 0}%) and ${inacc} Inaccessibility (${total ? Math.round((inacc / total) * 100) : 0}%).` +
    (highestRisk[0] ? ` ${highestRisk[0].facility} carried the highest volume (${highestRisk[0].cur}).` : ""));
  if (mostImproved.length) narrative.push(`${mostImproved.length} facilit${mostImproved.length === 1 ? "y" : "ies"} improved month-over-month, led by ${mostImproved.slice(0, 3).map((m) => `${m.facility} (▼${m.diff})`).join(", ")}.`);
  if (impact.length) narrative.push(`Logged corrective actions are showing measurable returns — ${impact[0].cat} leads at ~${impact[0].avgRed}% average complaint reduction.`);

  return { periodLabel: cur.label, total, prevTotal, reductionPct, lotFull, inacc, mostImproved, highestRisk, rootCauses, actionImpact: impact, recommendations, narrative, facilitiesActive: curMap.size };
}

function escHtml(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function summaryHtml(s: SummaryData, preparedBy: string, generatedAt: string): string {
  const redClass = s.reductionPct > 0 ? "good" : s.reductionPct < 0 ? "bad" : "muted";
  const redText = s.reductionPct > 0 ? `▼ ${s.reductionPct}% reduction` : s.reductionPct < 0 ? `▲ ${Math.abs(s.reductionPct)}% increase` : "No change";
  const rows = (arr: string[][]) => arr.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "num" : ""}">${escHtml(c)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Executive Summary — ${escHtml(s.periodLabel)}</title>
<style>
*{box-sizing:border-box} body{font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;background:#fff}
.wrap{max-width:880px;margin:0 auto;padding:40px}
.head{border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:24px}
h1{font-size:24px;margin:0 0 4px} .sub{color:#64748b;font-size:13px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:#4f46e5;margin:26px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:5px}
.kpis{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0}
.kpi{flex:1;min-width:150px;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px}
.kpi .l{font-size:11px;text-transform:uppercase;color:#94a3b8} .kpi .v{font-size:26px;font-weight:700;margin-top:2px}
.good{color:#059669} .bad{color:#e11d48} .muted{color:#64748b}
p{margin:8px 0} ul{margin:8px 0 8px 18px} li{margin:4px 0}
table{width:100%;border-collapse:collapse;margin-top:6px} th,td{padding:7px 10px;border-bottom:1px solid #eef2f7;text-align:left;font-size:13px}
th{background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:11px} td.num,th.num{text-align:right}
.foot{margin-top:34px;border-top:1px solid #e2e8f0;padding-top:12px;color:#94a3b8;font-size:11px}
@media print{.wrap{padding:0}}
</style></head><body><div class="wrap">
<div class="head"><h1>Facility Operations — Executive Summary</h1><div class="sub">${escHtml(s.periodLabel)} &nbsp;·&nbsp; Prepared by ${escHtml(preparedBy)} &nbsp;·&nbsp; Generated ${escHtml(generatedAt)}</div></div>
<div class="kpis">
<div class="kpi"><div class="l">Total Complaints</div><div class="v">${s.total}</div></div>
<div class="kpi"><div class="l">vs Prior Month</div><div class="v ${redClass}">${redText}</div></div>
<div class="kpi"><div class="l">Active Facilities</div><div class="v">${s.facilitiesActive}</div></div>
<div class="kpi"><div class="l">Lot Full / Inacc.</div><div class="v">${s.lotFull} / ${s.inacc}</div></div>
</div>
<h2>Executive Overview</h2>${s.narrative.map((n) => `<p>${escHtml(n)}</p>`).join("")}
<h2>Most Improved Facilities</h2>${s.mostImproved.length ? `<table><thead><tr><th>Facility</th><th class="num">Prev</th><th class="num">Current</th><th class="num">Reduction</th></tr></thead><tbody>${rows(s.mostImproved.map((m) => [m.facility, String(m.prev), String(m.cur), `▼ ${m.diff}`]))}</tbody></table>` : `<p class="muted">No month-over-month improvements recorded.</p>`}
<h2>Highest Risk Facilities</h2>${s.highestRisk.length ? `<table><thead><tr><th>Facility</th><th class="num">Complaints</th><th class="num">MoM Growth</th><th class="num">Risk Index</th></tr></thead><tbody>${rows(s.highestRisk.map((r) => [r.facility, String(r.cur), r.growth > 0 ? `+${r.growth}` : String(r.growth), String(r.score)]))}</tbody></table>` : `<p class="muted">No facilities with complaints this period.</p>`}
<h2>Complaint Drivers</h2><p>Lot Full: <b>${s.lotFull}</b> &nbsp;·&nbsp; Inaccessibility: <b>${s.inacc}</b>.</p>${s.rootCauses.length ? `<table><thead><tr><th>Root Cause</th><th class="num">Count</th></tr></thead><tbody>${rows(s.rootCauses.map((r) => [r.cause, String(r.count)]))}</tbody></table>` : `<p class="muted">Root causes not yet classified for this period.</p>`}
<h2>Corrective Action Impact</h2>${s.actionImpact.length ? `<table><thead><tr><th>Action</th><th class="num">Avg Reduction</th><th class="num">Facilities Improved</th></tr></thead><tbody>${rows(s.actionImpact.map((a) => [a.cat, `${a.avgRed}%`, String(a.facsImproved)]))}</tbody></table>` : `<p class="muted">No corrective actions with measured impact yet.</p>`}
<h2>Recommendations</h2>${s.recommendations.length ? `<ul>${s.recommendations.map((r) => `<li>${escHtml(r)}</li>`).join("")}</ul>` : `<p class="muted">No recommendations generated.</p>`}
<div class="foot">Auto-generated from complaint history. Figures reflect data available at generation time.</div>
</div></body></html>`;
}

function Summary({ records }: { records: ComplaintRecord[] }) {
  const [notes, setNotes] = useState<FacilityNote[]>([]);
  const months = useMemo(() => monthlySeries(records), [records]);
  const [key, setKey] = useState("");
  useEffect(() => { fetch("/api/complaint-notes").then((r) => r.json()).then((j) => { if (j?.ok) setNotes(j.notes); }).catch(() => {}); }, []);
  useEffect(() => { if (months.length && !key) setKey(months[months.length - 1].key); }, [months, key]);

  const data = useMemo(() => (key ? buildSummary(records, notes, key) : null), [records, notes, key]);
  const preparedBy = (typeof window !== "undefined" && localStorage.getItem(NAME_KEY)) || "Operations";
  const generatedAt = new Date().toLocaleString();

  function exportPdf() { if (data) printHtml(summaryHtml(data, preparedBy, generatedAt)); }
  function exportHtml() { if (data) downloadHtml(`executive-summary-${key}.html`, summaryHtml(data, preparedBy, generatedAt)); }

  if (months.length === 0) return <Empty msg="No complaint history yet — upload data first." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">An auto-generated, presentation-ready monthly executive summary — volume, reduction, most-improved and highest-risk facilities, drivers, action impact, and recommendations.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Sel v={key} on={setKey} opts={months.map((m) => [m.key, m.label] as [string, string])} />
          <button type="button" onClick={exportPdf} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Export PDF</button>
          <button type="button" onClick={exportHtml} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Export HTML</button>
        </div>
      </div>

      {!data ? <Empty msg="Select a month." /> : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 border-b-2 border-indigo-500 pb-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Facility Operations — Executive Summary</h2>
            <p className="mt-0.5 text-xs text-slate-400">{data.periodLabel} · Prepared by {preparedBy} · Generated {generatedAt}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Total complaints" value={data.total} />
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[11px] uppercase text-slate-400">vs prior month</p>
              <p className={`mt-1 text-lg font-bold ${data.reductionPct > 0 ? "text-emerald-600 dark:text-emerald-400" : data.reductionPct < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400"}`}>{data.reductionPct > 0 ? `▼ ${data.reductionPct}%` : data.reductionPct < 0 ? `▲ ${Math.abs(data.reductionPct)}%` : "—"}</p>
            </div>
            <Mini label="Active facilities" value={data.facilitiesActive} />
            <Mini label="Lot Full / Inacc." value={`${data.lotFull} / ${data.inacc}`} />
          </div>

          <SummarySection title="Executive Overview">
            {data.narrative.map((n, i) => <p key={i} className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{n}</p>)}
          </SummarySection>

          <div className="grid gap-5 md:grid-cols-2">
            <SummarySection title="Most Improved Facilities">
              {data.mostImproved.length === 0 ? <p className="text-sm text-slate-400">None this period.</p> : (
                <ul className="space-y-1 text-sm">{data.mostImproved.map((m) => <li key={m.facility} className="flex justify-between"><span className="text-slate-700 dark:text-slate-200">{m.facility}</span><span className="font-semibold text-emerald-600 dark:text-emerald-400">▼ {m.diff} ({m.prev}→{m.cur})</span></li>)}</ul>
              )}
            </SummarySection>
            <SummarySection title="Highest Risk Facilities">
              {data.highestRisk.length === 0 ? <p className="text-sm text-slate-400">None this period.</p> : (
                <ul className="space-y-1 text-sm">{data.highestRisk.map((r) => <li key={r.facility} className="flex justify-between"><span className="text-slate-700 dark:text-slate-200">{r.facility}</span><span className="text-slate-500">{r.cur}{r.growth > 0 ? <span className="text-rose-500"> (+{r.growth})</span> : null} · idx {r.score}</span></li>)}</ul>
              )}
            </SummarySection>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <SummarySection title="Complaint Drivers">
              <p className="text-sm text-slate-700 dark:text-slate-300">Lot Full: <b>{data.lotFull}</b> · Inaccessibility: <b>{data.inacc}</b></p>
              {data.rootCauses.length > 0 && <ul className="mt-1 space-y-0.5 text-sm text-slate-600 dark:text-slate-300">{data.rootCauses.map((r) => <li key={r.cause}>{r.cause}: {r.count}</li>)}</ul>}
            </SummarySection>
            <SummarySection title="Corrective Action Impact">
              {data.actionImpact.length === 0 ? <p className="text-sm text-slate-400">No measured action impact yet.</p> : (
                <ul className="space-y-1 text-sm">{data.actionImpact.map((a) => <li key={a.cat} className="flex justify-between"><span className="text-slate-700 dark:text-slate-200">{a.cat}</span><span className="font-semibold text-emerald-600 dark:text-emerald-400">~{a.avgRed}% ({a.facsImproved})</span></li>)}</ul>
              )}
            </SummarySection>
          </div>

          <SummarySection title="Recommendations">
            {data.recommendations.length === 0 ? <p className="text-sm text-slate-400">No recommendations generated.</p> : (
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-700 dark:text-slate-300">{data.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
            )}
          </SummarySection>
        </div>
      )}
    </div>
  );
}
function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-1.5 border-b border-slate-200 pb-1 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:border-slate-800 dark:text-indigo-400">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/* --------------------------------- Upload ---------------------------------- */
function Upload({ uploads, onUploaded }: { uploads: UploadLog[]; onUploaded: () => void }) {
  const [files, setFiles] = useState<ParsedCsv[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const incidents = useMemo(() => files.flatMap(extractIncidents), [files]);

  async function save() {
    if (incidents.length === 0) return;
    setBusy(true); setMsg(null);
    const pat = localStorage.getItem(PAT_KEY);
    const uploadedBy = localStorage.getItem(NAME_KEY) || "Unknown";
    const fileName = files.map((f) => f.fileName).join(", ");
    try {
      const res = await fetch("/api/complaint-history", { method: "POST", headers: { "Content-Type": "application/json", ...(pat ? { "x-airtable-pat": pat } : {}) }, body: JSON.stringify({ fileName, uploadedBy, incidents }) });
      const j = await res.json();
      if (j?.ok) {
        // Also persist raw rows + per-facility financials for the History view.
        const { rows: shRows, financials } = extractSpotHeroData(files, fileName, new Date().toISOString());
        fetch("/api/spothero-store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName, rows: shRows, financials }) }).catch(() => {});
        setMsg(`Stored ${j.log.newRecordsAdded} new · skipped ${j.log.duplicateRecordsSkipped} duplicate(s).`); setFiles([]); onUploaded();
      }
      else setMsg(j?.error || "Upload failed.");
    } catch { setMsg("Upload failed."); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card title="Upload SpotHero complaints">
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Upload SpotHero CSVs (<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">cp_accounting_detail…</code>). Lot Full &amp; Inaccessibility are extracted and stored permanently — duplicates (by Rental ID) are skipped, so re-uploading the same file is safe.</p>
        <MultiFileUpload value={files} onChange={setFiles} validate={(d) => (isAccountingReport(d.fileName) ? null : "Only SpotHero accounting CSVs (cp_accounting_detail…) are accepted.")} />
        {incidents.length > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700">{busy ? "Storing…" : `Store ${incidents.length} complaints`}</button>
            <span className="text-xs text-slate-400">Uploaded by: {(typeof window !== "undefined" && localStorage.getItem(NAME_KEY)) || "set your name in Settings"}</span>
          </div>
        )}
        {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{msg}</p>}
      </Card>
      <Card title="Upload History Log">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-2 pr-3">File</th><th className="px-2">Date</th><th className="px-2">By</th><th className="px-2 text-right">Total</th><th className="px-2 text-right">New</th><th className="px-2 text-right">Skipped</th></tr></thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="max-w-[220px] truncate py-2 pr-3 text-slate-700 dark:text-slate-200" title={u.fileName}>{u.fileName}</td>
                  <td className="px-2 whitespace-nowrap text-slate-500">{u.uploadDate.slice(0, 10)}</td>
                  <td className="px-2 text-slate-500">{u.uploadedBy}</td>
                  <td className="px-2 text-right tabular-nums">{u.totalRecords}</td>
                  <td className="px-2 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{u.newRecordsAdded}</td>
                  <td className="px-2 text-right tabular-nums text-slate-400">{u.duplicateRecordsSkipped}</td>
                </tr>
              ))}
              {uploads.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No uploads yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------- Reports --------------------------------- */
function Reports({ records }: { records: ComplaintRecord[] }) {
  const [filters, setFilters] = useState<Filters>({});
  const [notes, setNotes] = useState<FacilityNote[]>([]);
  const rows = useMemo(() => applyFilters(records, filters), [records, filters]);

  useEffect(() => {
    fetch("/api/complaint-notes").then((r) => r.json()).then((j) => { if (j?.ok) setNotes(j.notes); }).catch(() => {});
  }, []);

  function snapshotCharts(): string[] {
    return Array.from(document.querySelectorAll<HTMLCanvasElement>("main canvas")).map((cv) => {
      const tmp = document.createElement("canvas");
      tmp.width = cv.width; tmp.height = cv.height;
      const ctx = tmp.getContext("2d");
      if (ctx) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, tmp.width, tmp.height); ctx.drawImage(cv, 0, 0); }
      return tmp.toDataURL("image/png");
    });
  }

  function buildHtml(): string {
    const c = tally(rows);
    const facs = facilityRollup(rows, "biweekly");
    const top = [...facs].sort((a, b) => b.counts.total - a.counts.total).slice(0, 10);
    const improvedF = facs.filter((f) => f.dir === "down").sort((a, b) => (a.current - a.previous) - (b.current - b.previous)).slice(0, 8);
    const risingF = facs.filter((f) => f.dir === "up").sort((a, b) => (b.current - b.previous) - (a.current - a.previous)).slice(0, 8);
    const bw = biweeklySeries(rows);
    const cur = bw[bw.length - 1], prev = bw[bw.length - 2];
    const dPct = (n: number, d: number) => (d ? Math.round(((n - d) / d) * 1000) / 10 : 0);
    const progDir = cur && prev ? (cur.counts.total < prev.counts.total ? "down" : cur.counts.total > prev.counts.total ? "up" : "flat") : "flat";
    const charts = snapshotCharts();

    const dates = rows.map((r) => r.complaintDate).filter(Boolean).sort();
    const scope = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "all time";
    const lfPct = c.total ? Math.round((c.lotFull / c.total) * 100) : 0;

    const narrative = cur
      ? `Across <b>${c.total}</b> complaints (${c.lotFull} Lot Full · ${c.inaccessibility} Inaccessibility), the latest bi-weekly period (<b>${esc(cur.range)}</b>) recorded <b>${cur.counts.total}</b> complaints${prev ? `, ${progDir === "down" ? "a reduction of" : progDir === "up" ? "an increase of" : "no change vs"} <b>${Math.abs(cur.counts.total - prev.counts.total)}</b> (${Math.abs(dPct(cur.counts.total, prev.counts.total))}%) versus the prior period` : ""}. ${improvedF.length} facilities improved and ${risingF.length} are trending up. Lot Full drives ${lfPct}% of complaints.`
      : "No complaints in the selected scope yet.";

    const trendRows = bw.slice(-8).map((s, i, a) => {
      const p = a[i - 1];
      const diff = p ? s.counts.total - p.counts.total : 0;
      const col = diff < 0 ? "#059669" : diff > 0 ? "#e11d48" : "#94a3b8";
      return `<tr><td>${esc(s.range)}</td><td class=r>${s.counts.total}</td><td class=r>${s.counts.lotFull}</td><td class=r>${s.counts.inaccessibility}</td><td class=r style="color:${col}">${p ? (diff < 0 ? "▼" : diff > 0 ? "▲" : "—") + (diff !== 0 ? " " + Math.abs(diff) : "") : "—"}</td></tr>`;
    }).join("");

    const facTbl = (list: typeof improvedF, good: boolean) => list.length
      ? `<table><tr><th>Facility</th><th class=r>Prev</th><th class=r>Now</th><th class=r>Change</th></tr>${list.map((f) => `<tr><td>${esc(f.name)}</td><td class=r>${f.previous}</td><td class=r>${f.current}</td><td class=r style="color:${good ? "#059669" : "#e11d48"};font-weight:700">${good ? "▼" : "▲"} ${Math.abs(f.current - f.previous)}</td></tr>`).join("")}</table>`
      : "<p class=muted>None.</p>";

    const topRows = top.map((f, i) => `<tr><td>${i + 1}</td><td>${esc(f.name)}</td><td class=r>${f.counts.total}</td><td class=r>${f.counts.lotFull}</td><td class=r>${f.counts.inaccessibility}</td><td class=r style="color:${f.dir === "down" ? "#059669" : f.dir === "up" ? "#e11d48" : "#94a3b8"}">${f.dir === "down" ? "▼" : f.dir === "up" ? "▲" : "—"}${f.dir !== "flat" ? " " + Math.abs(f.current - f.previous) : ""}</td></tr>`).join("");

    const recBlocks = top.slice(0, 6).map((f) => {
      const r = recommendFor({ name: f.name, lotFull: f.counts.lotFull, inaccessibility: f.counts.inaccessibility, trendUp: f.dir === "up" });
      const plan = r.actionPlan.map((p) => `<div class=phase><b>${esc(p.phase)}</b> <span class=muted>· ${esc(p.owner)} · due ${p.dueInDays}d</span><ul>${p.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul><div class=outcome>→ ${esc(p.expectedOutcome)}</div></div>`).join("");
      return `<div class=card><div class=cardhead><b>${esc(f.name)}</b><span class="pill ${r.priority.toLowerCase()}">${r.priority}</span><span class=pill2>Focus: ${r.focus}</span></div>
<p>${esc(r.summary)}</p>
<div class=cols><div><div class=sub>Likely root causes</div><ul>${r.rootCauses.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div><div><div class=sub>Recommended actions</div><ul>${r.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
<div class=impact>${esc(r.expectedImpact)}</div><div class=plan>${plan}</div></div>`;
    }).join("");

    const noteRows = notes.slice(0, 40).map((n) => `<tr><td>${esc(n.facilityName)}</td><td>${esc(n.category)}</td><td>${esc(n.note)}</td><td>${esc(n.author)}</td><td>${esc(n.dateCreated)}</td></tr>`).join("");

    return `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facility Complaint Progress Report</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:980px;margin:0 auto;padding:0 20px 48px;line-height:1.55}
.band{background:linear-gradient(135deg,#4338ca,#6366f1);color:#fff;margin:0 -20px 0;padding:32px 28px;border-radius:0 0 16px 16px}
.band h1{margin:0;font-size:25px;letter-spacing:-.01em}.band .meta{margin-top:8px;font-size:13px;opacity:.9;display:flex;gap:18px;flex-wrap:wrap}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#4338ca;margin:34px 0 12px;display:flex;align-items:center;gap:10px}
h2::before{content:"";width:6px;height:18px;background:#6366f1;border-radius:3px;display:inline-block}
.narr{font-size:15px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:14px 18px}
.takeaways{list-style:none;padding:0;margin:14px 0;display:grid;gap:8px}.takeaways li{background:#fff;border:1px solid #e2e8f0;border-left:4px solid #6366f1;border-radius:8px;padding:10px 14px;font-size:14px}
.kpis{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.kpi{flex:1;min-width:120px;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;background:#fff}.kpi b{font-size:26px;display:block;color:#4338ca}.kpi span{font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:.03em}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #eef2f7;padding:8px 9px;text-align:left}th{color:#64748b;font-size:11px;text-transform:uppercase;background:#f8fafc}.r{text-align:right}
img{max-width:100%;border:1px solid #e2e8f0;border-radius:12px;margin:10px 0}
.two{display:flex;gap:16px;flex-wrap:wrap}.two>div{flex:1;min-width:280px}.two h3{font-size:13px;margin:0 0 6px;color:#334155}
.card{border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin:12px 0;page-break-inside:avoid;background:#fff}.cardhead{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.pill{font-size:11px;font-weight:700;color:#fff;border-radius:999px;padding:2px 9px}.pill.high{background:#e11d48}.pill.medium{background:#f59e0b}.pill.low{background:#94a3b8}
.pill2{font-size:11px;font-weight:600;color:#4338ca;background:#eef2ff;border-radius:999px;padding:2px 9px}
.cols{display:flex;gap:24px;flex-wrap:wrap;margin-top:8px}.cols>div{flex:1;min-width:220px}.sub{font-size:11px;text-transform:uppercase;color:#64748b;margin:6px 0 2px;font-weight:700}
ul{margin:4px 0;padding-left:18px}.impact{color:#059669;font-weight:600;font-size:13px;margin-top:10px}
.plan{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}.phase{flex:1;min-width:200px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;font-size:12px}.outcome{color:#059669;font-style:italic;margin-top:6px}.muted{color:#94a3b8}
@media print{.band{-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{page-break-after:avoid}}
</style></head><body>
<div class=band><h1>Facility Complaint Progress Report</h1><div class=meta><span>Generated ${esc(new Date().toLocaleString())}</span><span>Scope: ${esc(scope)}</span><span>${rows.length} complaints</span></div></div>
<h2>Executive Summary</h2>
<div class=narr>${narrative}</div>
<ul class=takeaways>
${improvedF[0] ? `<li>📉 <b>Biggest improvement:</b> ${esc(improvedF[0].name)} — ${Math.abs(improvedF[0].current - improvedF[0].previous)} fewer cases vs the previous bi-weekly period.</li>` : ""}
${risingF[0] ? `<li>📈 <b>Needs attention:</b> ${esc(risingF[0].name)} — ${Math.abs(risingF[0].current - risingF[0].previous)} more cases vs the previous bi-weekly period.</li>` : ""}
<li>${progDir === "down" ? "✅ Overall complaints are trending <b>down</b> in the latest period." : progDir === "up" ? "⚠️ Overall complaints <b>rose</b> in the latest period." : "➖ Overall complaints held <b>steady</b> in the latest period."}</li>
</ul>
<div class=kpis><div class=kpi><b>${c.total}</b><span>Total</span></div><div class=kpi><b>${c.spotHero}</b><span>SpotHero</span></div><div class=kpi><b>${c.internal}</b><span>Internal</span></div><div class=kpi><b>${c.lotFull}</b><span>Lot Full</span></div><div class=kpi><b>${c.inaccessibility}</b><span>Inaccessibility</span></div></div>
<h2>Progress Analysis</h2>
<p>Bi-weekly complaint volume (primary KPI) over the most recent periods:</p>
<table><tr><th>Period</th><th class=r>Total</th><th class=r>Lot Full</th><th class=r>Inacc.</th><th class=r>vs prev</th></tr>${trendRows || "<tr><td colspan=5 class=muted>No data.</td></tr>"}</table>
<h2>Most Improved &amp; Increasing Facilities</h2>
<div class=two><div><h3>✅ Most Improved (fewer cases vs previous)</h3>${facTbl(improvedF, true)}</div><div><h3>⚠️ Increasing Complaints (more cases vs previous)</h3>${facTbl(risingF, false)}</div></div>
<h2>Top 10 Facilities</h2><table><tr><th>#</th><th>Facility</th><th class=r>Total</th><th class=r>Lot Full</th><th class=r>Inacc.</th><th class=r>Δ vs prev</th></tr>${topRows}</table>
<h2>Recommendations &amp; Action Plans</h2>${recBlocks || "<p class=muted>No facilities in scope.</p>"}
<h2>Manual Notes &amp; Actions Taken</h2>${noteRows ? `<table><tr><th>Facility</th><th>Type</th><th>Note</th><th>By</th><th>Date</th></tr>${noteRows}</table>` : "<p class=muted>No notes recorded.</p>"}
<h2>Trend Charts</h2>${charts.map((d) => `<img src="${d}"/>`).join("") || "<p class=muted>No charts available.</p>"}
</body></html>`;
  }

  return (
    <div className="space-y-4">
      <Card title="Report filters">
        <FiltersBar records={records} value={filters} onChange={setFilters} />
        <p className="mt-2 text-xs text-slate-400">{rows.length} complaints in scope. Export includes: executive summary + narrative, bi-weekly progress trend, most-improved/increasing facilities, Top-10, recommendations + action plans, manual notes, and the charts below.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => printHtml(buildHtml())} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Export PDF</button>
          <button type="button" onClick={() => downloadHtml("facility-progress-report.html", buildHtml())} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Export HTML</button>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Bi-Weekly Trend"><TrendChart series={biweeklySeries(rows)} kind="bar" /></Card>
        <Card title="Monthly Trend"><TrendChart series={monthlySeries(rows)} kind="bar" /></Card>
      </div>
    </div>
  );
}
function esc(s: string): string { return s.replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]!)); }

/* ------------------------------- shared atoms ------------------------------ */
/** Chart.js plugin: draw the stacked total above each bar / line point. */
function totalLabels(color: string) {
  return {
    id: "totalLabels",
    afterDatasetsDraw(chart: {
      ctx: CanvasRenderingContext2D;
      data: { datasets: { data: unknown[] }[] };
      getDatasetMeta: (i: number) => { data: { x: number; y: number }[] };
    }) {
      const { ctx } = chart;
      const ds = chart.data.datasets;
      if (!ds.length) return;
      const n = chart.getDatasetMeta(0).data.length;
      ctx.save();
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      for (let i = 0; i < n; i++) {
        let total = 0;
        let topY = Infinity;
        let x = 0;
        ds.forEach((d, di) => {
          total += Number(d.data[i]) || 0;
          const el = chart.getDatasetMeta(di).data[i];
          if (el) { if (el.y < topY) topY = el.y; x = el.x; }
        });
        if (total > 0) ctx.fillText(String(total), x, topY - 6);
      }
      ctx.restore();
    },
  };
}

function TrendChart({ series, kind }: { series: SeriesPoint[]; kind: "bar" | "line" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  const config = useMemo<ChartConfiguration>(() => ({
    type: kind,
    plugins: [totalLabels(text)],
    data: {
      labels: series.map((s) => s.label),
      datasets: [
        { label: "Lot Full", data: series.map((s) => s.counts.lotFull), backgroundColor: "#3b82f6", borderColor: "#3b82f6", tension: 0.3, stack: "a" },
        { label: "Inaccessibility", data: series.map((s) => s.counts.inaccessibility), backgroundColor: "#a855f7", borderColor: "#a855f7", tension: 0.3, stack: "a" },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } }, plugins: { legend: { labels: { color: text, boxWidth: 12 } }, tooltip: { callbacks: { footer: (items: { parsed: { y: number | null } }[]) => `Total: ${items.reduce((s, it) => s + (it.parsed.y || 0), 0)}` } } }, scales: { x: { stacked: true, ticks: { color: text, font: { size: 10 } }, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { color: text, precision: 0 }, grid: { color: grid } } } },
  }), [series, kind, text, grid]);
  if (series.length === 0) return <Empty msg="No data for this view yet." />;
  return <ChartCanvas height={260} config={config} />;
}
function Stat({ label, value, tone }: { label: string; value: number; tone: "indigo" | "blue" | "purple" }) {
  const t = { indigo: "text-indigo-600 dark:text-indigo-400", blue: "text-blue-600 dark:text-blue-400", purple: "text-purple-600 dark:text-purple-400" }[tone];
  const bar = { indigo: "bg-indigo-500", blue: "bg-blue-500", purple: "bg-purple-500" }[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <span className={`absolute inset-x-0 top-0 h-1 ${bar}`} />
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${t}`}>{value.toLocaleString()}</p>
    </div>
  );
}
function Mini({ label, value, tone, arrow }: { label: string; value: string | number; tone?: "good" | "bad"; arrow?: "down" | "up" | "flat" }) {
  const t = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100";
  return <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800/50"><p className="text-[11px] text-slate-400">{label}</p><p className={`text-xl font-bold ${t}`}>{arrow && arrow !== "flat" ? (arrow === "down" ? "▼ " : "▲ ") : ""}{value}</p></div>;
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h3>{children}</div>;
}
function Empty({ msg }: { msg: string }) { return <p className="py-6 text-center text-sm text-slate-400">{msg}</p>; }
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`whitespace-nowrap px-4 py-2.5 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, right, className = "", title }: { children?: React.ReactNode; right?: boolean; className?: string; title?: string }) {
  return <td title={title} className={`whitespace-nowrap px-4 py-2.5 text-slate-700 dark:text-slate-300 ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>;
}
function Sel({ v, on, opts, disabled, className }: { v: string; on: (v: string) => void; opts: [string, string][]; disabled?: boolean; className?: string }) {
  return <select value={v} disabled={disabled} onChange={(e) => on(e.target.value)} className={`max-w-full truncate rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-opacity focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className ?? ""}`}>{opts.map(([val, label]) => <option key={val} value={val}>{label}</option>)}</select>;
}
