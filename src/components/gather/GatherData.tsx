"use client";

import { useState } from "react";
import GatherOneReport from "./GatherOneReport";
import StoredHistory from "./StoredHistory";

export default function GatherData() {
  const [tab, setTab] = useState<"report" | "history">("report");
  return (
    <div className="space-y-5">
      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1 dark:border-slate-800 dark:bg-slate-800/40">
        {(["report", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${
              tab === t
                ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {t === "report" ? "Report" : "History"}
          </button>
        ))}
      </div>
      {tab === "report" ? <GatherOneReport /> : <StoredHistory />}
    </div>
  );
}
