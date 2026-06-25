"use client";

import { useState } from "react";
import OverbookingChecker from "./OverbookingChecker";
import AllFacilities from "./AllFacilities";

type View = "menu" | "facility" | "all";

export default function OverbookHome() {
  const [view, setView] = useState<View>("menu");

  if (view !== "menu") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setView("menu")}
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>
        {view === "facility" ? <OverbookingChecker /> : <AllFacilities />}
      </div>
    );
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Overbook Checker
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose how you want to check for overbooking.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <ActionCard
          title="Check Overbook by Facility"
          description="Scan one facility against its stalls — monthly, transient, the 30-day forecast, and whether a new reservation fits."
          onClick={() => setView("facility")}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
        />
        <ActionCard
          title="Check All Facilities"
          description="Scan every facility at once to find which are already overbooked within the next 30 days — so you can fix them."
          onClick={() => setView("all")}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

function ActionCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/50"
    >
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-600 group-hover:text-white dark:bg-indigo-500/15 dark:text-indigo-400 dark:group-hover:bg-indigo-600 dark:group-hover:text-white">
        {icon}
      </span>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {description}
      </p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 transition-transform group-hover:translate-x-0.5 dark:text-indigo-400">
        Open
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </span>
    </button>
  );
}
