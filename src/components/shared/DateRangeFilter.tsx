"use client";

import type { DateRange } from "@/lib/reports/analyze";

/**
 * Compact "start → end" date filter. Both bounds are optional; clearing both
 * removes the filter. Any date can be selected — the pickers are not limited to
 * the data's range (the analysis simply keeps rows that fall inside).
 */
export default function DateRangeFilter({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const active = Boolean(value.start || value.end);
  const inputCls =
    "rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30 [color-scheme:light] dark:[color-scheme:dark]";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {label && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {label}
        </span>
      )}
      <input
        type="date"
        aria-label={`${label ? label + " " : ""}start date`}
        value={value.start ?? ""}
        onChange={(e) =>
          onChange({ ...value, start: e.target.value || undefined })
        }
        className={inputCls}
      />
      <span className="text-slate-400 dark:text-slate-500">–</span>
      <input
        type="date"
        aria-label={`${label ? label + " " : ""}end date`}
        value={value.end ?? ""}
        onChange={(e) =>
          onChange({ ...value, end: e.target.value || undefined })
        }
        className={inputCls}
      />
      {active && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="rounded-md px-1.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
        >
          Reset
        </button>
      )}
    </div>
  );
}
