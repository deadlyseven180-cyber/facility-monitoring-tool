"use client";

export interface BarDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  title: string;
  data: BarDatum[];
  /** Tailwind bg color class for the filled bar. */
  barClass?: string;
  /** Format a value for its label (e.g. currency). */
  formatValue?: (v: number) => string;
}

/**
 * Lightweight, dependency-free horizontal bar chart. Theme-aware and
 * handles long facility labels better than a vertical chart.
 */
export default function BarChart({
  title,
  data,
  barClass = "bg-indigo-500",
  formatValue = (v) => String(v),
}: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h4 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
        {title}
      </h4>
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          No data.
        </p>
      ) : (
        <div className="space-y-3">
          {data.map((d) => {
            const pct = Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0);
            return (
              <div key={d.label}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span
                    className="truncate text-xs font-medium text-slate-600 dark:text-slate-300"
                    title={d.label}
                  >
                    {d.label}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                    {formatValue(d.value)}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full ${barClass}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
