"use client";

import ThemeToggle from "@/components/theme/ThemeToggle";

/** Sticky top bar: shows where you are + global actions. */
export default function TopBar({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-8 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-400 dark:text-slate-500">YourSpotRented</span>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </span>
      </div>
      <ThemeToggle />
    </header>
  );
}
