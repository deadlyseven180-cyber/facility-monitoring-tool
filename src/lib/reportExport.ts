import type { ReportResult } from "@/types/report";
import { formatCurrency } from "./format";
import { toIsoDate } from "./reports/columns";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}, ${y}`;
}

/** Inclusive date range as ISO `YYYY-MM-DD` strings (either bound optional). */
interface DateRange {
  start?: string;
  end?: string;
}

/**
 * Coverage follows the user's selected date range. When a bound isn't set, the
 * actual first/last dated record fills it in. e.g. picking May 1 – May 15 →
 * "May 1, 2026 – May 15, 2026".
 */
function dateCoverage(result: ReportResult, range?: DateRange): string {
  let min: string | null = null;
  let max: string | null = null;
  for (const r of result.records) {
    const iso = toIsoDate(r.starts);
    if (!iso) continue;
    if (min === null || iso < min) min = iso;
    if (max === null || iso > max) max = iso;
  }

  // Prefer the explicitly selected bounds; fall back to the data's extent.
  const first = range?.start || min;
  const last = range?.end || max;
  if (!first || !last) return "No dated records";
  return `${fmtLong(first)} – ${fmtLong(last)}`;
}

const BADGE: Record<string, { bg: string; fg: string }> = {
  Critical: { bg: "#fee2e2", fg: "#b91c1c" },
  High: { bg: "#ffedd5", fg: "#c2410c" },
  Medium: { bg: "#fef3c7", fg: "#b45309" },
  Low: { bg: "#dcfce7", fg: "#15803d" },
};

function badge(level: string): string {
  const c = BADGE[level] ?? BADGE.Low;
  return `<span class="badge" style="background:${c.bg};color:${c.fg}">${esc(level)}</span>`;
}

function refundRatePct(f: { refundColumnTotal: number; netRemit: number }): number {
  return f.netRemit > 0 ? (f.refundColumnTotal / f.netRemit) * 100 : 0;
}

/** Narrative summary of what the gathered data shows. */
export function buildSummary(result: ReportResult): string[] {
  const t = result.totals;
  const cat = result.filterLabel; // "All Issues" | "Lot Full" | "Inaccessibility"
  const complaintRate =
    t.reservations > 0 ? (t.incidentCount / t.reservations) * 100 : 0;
  const refundRateAll =
    t.netRemitTotal > 0 ? (t.refundAllTotal / t.netRemitTotal) * 100 : 0;
  const topState = result.states[0];
  const byScore = [...result.facilities].sort(
    (a, b) => b.priorityScore - a.priorityScore,
  );
  const top = byScore[0];
  const criticals = result.facilities.filter(
    (f) => f.priorityLevel === "Critical",
  ).length;

  const lines: string[] = [];
  lines.push(
    `During the reporting period, <b>${t.incidentCount}</b> ${cat} incidents were identified across <b>${t.facilitiesAffected}</b> facilities — a complaint rate of <b>${complaintRate.toFixed(2)}%</b> against <b>${t.reservations.toLocaleString()}</b> reservations.`,
  );
  lines.push(
    `Incident sourcing is split between <b>${t.spotHeroLotFull}</b> from SpotHero accounting data and <b>${t.internalLotFull}</b> from internal reconciliation, giving cross-validated visibility into where capacity is falling short.`,
  );
  lines.push(
    `${cat} refunds reached <b>${formatCurrency(t.refundTotal)}</b>, while total refunds held at <b>${refundRateAll.toFixed(2)}%</b> of net remit (<b>${formatCurrency(t.netRemitTotal)}</b>) — a direct measure of the revenue lost to availability failures.`,
  );
  if (topState)
    lines.push(
      `<b>${esc(topState.state)}</b> carried the highest incident concentration with <b>${topState.incidentCount}</b> ${cat} events, making it the priority region for capacity intervention.`,
    );
  if (top)
    lines.push(
      `<b>${esc(top.facility)}</b> is the single most affected site — <b>${top.incidentCount}</b> incidents, priority score ${top.priorityScore.toFixed(1)}, rated <b>${top.priorityLevel}</b> — and warrants immediate operational review.`,
    );
  if (criticals > 0)
    lines.push(
      `<b>${criticals}</b> facilit${criticals === 1 ? "y is" : "ies are"} classified <b>Critical</b> and should anchor the remediation roadmap.`,
    );
  return lines;
}

/** Recommended actions derived from the data. */
export function buildActionPlan(result: ReportResult): string[] {
  const cat = result.filterLabel;
  const recs: string[] = [];
  const byScore = [...result.facilities].sort(
    (a, b) => b.priorityScore - a.priorityScore,
  );
  for (const f of byScore.filter((x) => x.priorityLevel === "Critical").slice(0, 5)) {
    recs.push(
      `<b>Stabilize ${esc(f.facility)} (${esc(f.state)}) — Critical.</b> ${f.incidentCount} ${cat} incidents, priority score ${f.priorityScore.toFixed(1)}. Run an on-site capacity audit, validate live availability counts, and tighten oversell controls within the next reporting cycle.`,
    );
  }
  const highRefund = result.facilities
    .filter((f) => refundRatePct(f) >= 30)
    .sort((a, b) => refundRatePct(b) - refundRatePct(a))
    .slice(0, 5);
  if (highRefund.length)
    recs.push(
      `<b>Contain refund leakage.</b> Facilities exceeding a 30% refund-to-remit ratio require root-cause review: ${highRefund
        .map((f) => `${esc(f.facility)} (${refundRatePct(f).toFixed(0)}%)`)
        .join(", ")}.`,
    );
  const topStates = result.states
    .slice(0, 3)
    .map((s) => `${esc(s.state)} (${s.incidentCount})`)
    .join(", ");
  if (topStates)
    recs.push(
      `<b>Regional capacity planning.</b> Concentrate inventory governance in the highest-volume states: ${topStates}.`,
    );
  if (result.totals.internalLotFull > 0)
    recs.push(
      `<b>Reconcile reporting sources.</b> Cross-check the ${result.totals.internalLotFull} internally-logged ${cat} incidents against SpotHero records to maintain a single source of truth and eliminate double-counting.`,
    );
  recs.push(
    `<b>Institute weekly monitoring.</b> Track ${cat} counts and refund totals on a per-week basis so emerging hotspots are caught and contained before they escalate.`,
  );
  if (recs.length === 0)
    recs.push(
      "No critical issues detected. Maintain current monitoring cadence across facilities.",
    );
  return recs;
}

/** Broad, preventive measures to avoid or reduce the issues in scope. */
export function buildPreventionPlan(cat: string): string[] {
  return [
    "<b>Real-time availability sync</b> — keep SpotHero inventory in lock-step with each facility's live capacity so spots can't be sold beyond what's physically available.",
    "<b>Set sellable-capacity buffers</b> — cap online inventory below 100% at high-incidence facilities to absorb walk-ins, monthly parkers, and miscounts.",
    "<b>Overbooking alerts</b> — automatically flag and pause sales when a facility approaches capacity for a given arrival window.",
    "<b>Proactive rebooking</b> — when a lot is full or inaccessible, redirect customers to nearby partner facilities to cut refunds and complaints rather than issuing a refund.",
    `<b>Peak & event planning</b> — adjust inventory and pricing around recurring peak times and local events that historically drive ${cat}.`,
    "<b>Monthly capacity audits</b> — reconcile facility capacity and access data with operators and verify counts to eliminate stale or inflated availability.",
    `<b>Recurring-pattern tracking</b> — monitor the time windows and weekdays where ${cat} repeats per facility, and tighten controls for those slots.`,
    `<b>Operator accountability</b> — share ${cat} scorecards with facility operators and set reduction targets for the highest-priority sites.`,
  ];
}

/** A captured chart image (PNG data URL) with its title and on-screen section. */
export interface ChartImage {
  title: string;
  dataUrl: string;
  section?: string;
}

/** A table captured from the on-screen dashboard. */
export interface TableSnapshot {
  title: string;
  headers: string[];
  rows: string[][];
}

const NUM_COL = /complaints|refund|remit|rev|rate|score|amount|count/i;

/** Render a captured dashboard table with the report's styling. */
function renderTable(t: TableSnapshot): string {
  const priIdx = t.headers.findIndex((h) => /^priority$/i.test(h));
  const head = t.headers
    .map((h) => `<th class="${NUM_COL.test(h) ? "num" : ""}">${esc(h)}</th>`)
    .join("");
  const body = t.rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => {
            if (i === priIdx) return `<td>${badge(c)}</td>`;
            const cls = [
              NUM_COL.test(t.headers[i] ?? "") ? "num" : "",
              (t.headers[i] ?? "").trim() === "#" ? "muted" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `<td class="${cls}">${esc(c)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<h2>${esc(t.title)}</h2>
  <div class="panel"><table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td class="muted">No rows.</td></tr>`}</tbody>
  </table></div>`;
}

/** Build a self-contained, light-themed executive report (HTML / print → PDF). */
export function buildReportHtml(
  result: ReportResult,
  generatedAt: string,
  charts: ChartImage[] = [],
  dateRange?: DateRange,
  tables: TableSnapshot[] = [],
): string {
  const { totals } = result;
  const cat = result.filterLabel; // "All Issues" | "Lot Full" | "Inaccessibility"
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

  // Each card stacks a primary metric (colored) + a secondary metric under a
  // divider — matching the dashboard's stat cards.
  const kpiCard = (
    label: string,
    value: string,
    accent: string,
    subLabel: string,
    subValue: string,
  ) =>
    `<div class="kpi" style="border-top:3px solid ${accent}">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value" style="color:${accent}">${esc(value)}</div>
      <div class="kpi-sub">
        <div class="kpi-sublabel">${esc(subLabel)}</div>
        <div class="kpi-subvalue">${esc(subValue)}</div>
      </div>
    </div>`;

  const chartFig = (c: ChartImage) =>
    `<figure class="chart"><figcaption>${esc(c.title)}</figcaption><img src="${c.dataUrl}" alt="${esc(c.title)}" /></figure>`;
  // Group charts by their on-screen section so the export mirrors the dashboard
  // layout (each section laid out two-per-row).
  const chartSections: { name: string; items: ChartImage[] }[] = [];
  for (const c of charts) {
    const name = c.section || "Charts";
    let g = chartSections.find((s) => s.name === name);
    if (!g) {
      g = { name, items: [] };
      chartSections.push(g);
    }
    g.items.push(c);
  }
  const chartsHtml = chartSections
    .map(
      (s) =>
        `<h2>${esc(s.name)}</h2><div class="charts">${s.items.map(chartFig).join("")}</div>`,
    )
    .join("");

  // Tables captured live from the dashboard (facility summary + records), so the
  // export mirrors exactly what's shown — including the active sort/filter.
  // Falls back to a built Top-20 facility table if nothing was captured.
  const tablesHtml = tables.length
    ? tables.map(renderTable).join("")
    : `<h2>Facility Summary</h2><div class="panel"><table>
        <thead><tr><th>#</th><th>Facility</th><th>State</th>
        <th class="num">Complaints</th><th class="num">Refunds</th>
        <th class="num">Net Remit</th><th class="num">Score</th><th>Priority</th></tr></thead>
        <tbody>${[...result.facilities]
          .sort((a, b) => b.priorityScore - a.priorityScore)
          .slice(0, 20)
          .map(
            (f, i) =>
              `<tr><td class="muted">${i + 1}</td><td>${esc(f.facility)}</td><td>${esc(f.state)}</td><td class="num">${f.incidentCount}</td><td class="num">${formatCurrency(f.refundColumnTotal)}</td><td class="num">${formatCurrency(f.netRemit)}</td><td class="num">${f.priorityScore.toFixed(1)}</td><td>${badge(f.priorityLevel)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(cat)} Report</title>
<style>
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: "Segoe UI", system-ui, Arial, Helvetica, sans-serif;
    background: #f1f5f9; color: #0f172a; margin: 0; padding: 36px;
  }
  .head { border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.01em; color: #0f172a; }
  .coverage { color: #4f46e5; font-size: 14px; font-weight: 600; margin-top: 6px; }
  h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: .08em;
    color: #475569; margin: 32px 0 12px; font-weight: 700;
  }
  .kpis {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
  }
  .kpi {
    background: #ffffff;
    border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px;
    box-shadow: 0 1px 2px rgba(15,23,42,.04);
  }
  .kpi-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
    color: #64748b; font-weight: 600;
  }
  .kpi-value { font-size: 24px; font-weight: 800; margin-top: 6px; }
  .kpi-note { margin: -6px 0 4px; color: #64748b; font-size: 12px; line-height: 1.5; }
  .kpi-sub { border-top: 1px solid #e2e8f0; margin-top: 12px; padding-top: 10px; }
  .kpi-sublabel {
    font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
    color: #64748b; font-weight: 600;
  }
  .kpi-subvalue { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 3px; }
  .panel {
    background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px;
    padding: 6px 4px; box-shadow: 0 1px 2px rgba(15,23,42,.04);
  }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { padding: 9px 14px; text-align: left; border-bottom: 1px solid #eef2f7; }
  th {
    color: #64748b; font-weight: 700; font-size: 11px; text-transform: uppercase;
    letter-spacing: .04em; background: #f8fafc;
  }
  tr:last-child td { border-bottom: none; }
  td { color: #1e293b; }
  td.muted { color: #94a3b8; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge {
    display: inline-block; padding: 2px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 700;
  }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(460px, 1fr)); gap: 18px; }
  .charts-full { margin-bottom: 18px; }
  .chart {
    margin: 0; background: #ffffff; border: 1px solid #e2e8f0;
    border-radius: 14px; padding: 16px; box-shadow: 0 1px 2px rgba(15,23,42,.04);
  }
  .chart figcaption { font-size: 14px; font-weight: 700; color: #4338ca; margin-bottom: 10px; }
  .chart img { width: 100%; height: auto; display: block; border-radius: 8px; }
  .narrative {
    background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px;
    padding: 6px 22px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(15,23,42,.04);
  }
  .narrative li { margin: 10px 0; color: #334155; font-size: 13.5px; line-height: 1.55; }
  .narrative b, .actions b { color: #0f172a; }
  .actions {
    background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px;
    padding: 6px 22px; box-shadow: 0 1px 2px rgba(15,23,42,.04);
  }
  .actions li { margin: 10px 0; color: #334155; font-size: 13.5px; line-height: 1.55; }
  .foot { margin-top: 28px; color: #94a3b8; font-size: 11px; }
  @media print {
    body { padding: 16px; background: #ffffff; }
    .chart, tr, .kpi, .narrative, .actions { break-inside: avoid; }
    .kpis { grid-template-columns: repeat(4, 1fr); }
  }
</style>
</head>
<body>
  <div class="head">
    <h1>${esc(cat)} Report</h1>
    <div class="coverage">${esc(dateCoverage(result, dateRange))}</div>
  </div>

  <h2>Executive Summary</h2>
  <div class="kpis">
    ${kpiCard(
      `${cat} Incidents`,
      String(totals.incidentCount),
      "#4f46e5",
      "Complaint Rate",
      `${complaintRate.toFixed(2)}%`,
    )}
    ${kpiCard(
      "Total Net Remit",
      formatCurrency(totals.netRemitTotal),
      "#0d9488",
      "Average Revenue",
      formatCurrency(avgRevenueAll),
    )}
    ${kpiCard(
      `Total ${cat} Refunds`,
      formatCurrency(totals.refundTotal),
      "#e11d48",
      "Refund Rate",
      `${refundRateAll.toFixed(2)}%`,
    )}
    ${kpiCard(
      `SpotHero ${cat}`,
      String(totals.spotHeroLotFull),
      "#d97706",
      `Internal ${cat}`,
      String(totals.internalLotFull),
    )}
  </div>
  ${
    totals.inaccessibilityCount > 0
      ? `<p class="kpi-note">Internal ${esc(cat)} total includes <b>${totals.internalInaccessibility}</b> Inaccessibility + ${totals.internalLotFull - totals.internalInaccessibility} Lot Full = ${totals.internalLotFull}. SpotHero includes ${totals.spotHeroInaccessibility} Inaccessibility + ${totals.spotHeroLotFull - totals.spotHeroInaccessibility} Lot Full.</p>`
      : ""
  }

  <h2>Summary</h2>
  <div class="narrative">
    <ul>${buildSummary(result)
      .map((s) => `<li>${s}</li>`)
      .join("")}</ul>
  </div>

  ${chartsHtml}

  ${tablesHtml}

  <h2>Recommended Action Plan</h2>
  <div class="actions">
    <ol>${buildActionPlan(result)
      .map((s) => `<li>${s}</li>`)
      .join("")}</ol>
  </div>

  <h2>Preventive Measures — Reducing ${esc(cat)}</h2>
  <div class="actions">
    <ol>${buildPreventionPlan(cat)
      .map((s) => `<li>${s}</li>`)
      .join("")}</ol>
  </div>

  <div class="foot">Generated ${esc(generatedAt)}</div>
</body>
</html>`;
}

/** Download an HTML string as a .html file. */
export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Render HTML in a hidden iframe and open the print dialog (Save as PDF). */
export function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.srcdoc = html;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  };
  document.body.appendChild(iframe);
}
