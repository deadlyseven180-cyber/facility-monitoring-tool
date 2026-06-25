"use client";

import { formatCurrency } from "@/lib/format";

export interface DetailRow {
  rentalId: string;
  date: string;
  type?: string;
  state: string;
  refund: number | null;
}

/** Click-through detail for one facility: Rental ID, date/time, state, refund. */
export default function FacilityRecordsModal({
  facility,
  rows,
  onClose,
}: {
  facility: string;
  rows: DetailRow[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">{facility}</h3>
            <p className="text-xs text-slate-400">{rows.length} case{rows.length === 1 ? "" : "s"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-auto p-4">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No records.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-2 pr-3">Rental ID</th>
                  <th className="px-3">Date &amp; Time</th>
                  <th className="px-3">Type</th>
                  <th className="px-3">State</th>
                  <th className="px-3 text-right">Refund</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.rentalId || "x"}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-3 font-medium text-slate-800 dark:text-slate-100">{r.rentalId || "—"}</td>
                    <td className="px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">{r.date || "—"}</td>
                    <td className="px-3 whitespace-nowrap text-slate-500">{r.type || "—"}</td>
                    <td className="px-3 text-slate-600 dark:text-slate-300">{r.state || "—"}</td>
                    <td className="px-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{r.refund && r.refund > 0 ? formatCurrency(r.refund) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
