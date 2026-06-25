"use client";

interface DataTableProps {
  columns: string[];
  rows: Record<string, string>[];
  /** Max rows to render for performance. Default 100. */
  maxRows?: number;
  /** Optional per-row CSS classes, by row index. */
  rowClassName?: (row: Record<string, string>, index: number) => string;
}

/** Generic, scrollable preview table. Caps visible rows for large files. */
export default function DataTable({
  columns,
  rows,
  maxRows = 100,
  rowClassName,
}: DataTableProps) {
  const visible = rows.slice(0, maxRows);

  return (
    <div>
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left dark:bg-slate-800/60">
              {columns.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap border-b border-slate-200 px-4 py-2.5 font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                  rowClassName
                    ? rowClassName(row, i)
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className="whitespace-nowrap px-4 py-2 text-slate-700 dark:text-slate-300"
                  >
                    {row[col] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length || 1}
                  className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500"
                >
                  No rows to display.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows && (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          Showing first {maxRows} of {rows.length} rows.
        </p>
      )}
    </div>
  );
}
