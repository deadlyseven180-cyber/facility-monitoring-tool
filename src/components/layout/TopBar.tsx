"use client";

import ThemeToggle from "@/components/theme/ThemeToggle";

/** Sticky top bar: shows where you are + global actions. */
export default function TopBar({ title, onMenu }: { title: string; onMenu?: () => void }) {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6 lg:px-8 dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="-ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden text-slate-400 sm:inline dark:text-slate-500">YourSpotRented</span>
          <span className="hidden text-slate-300 sm:inline dark:text-slate-600">/</span>
          <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </span>
        </div>
      </div>
      <ThemeToggle />
    </header>
  );
}
