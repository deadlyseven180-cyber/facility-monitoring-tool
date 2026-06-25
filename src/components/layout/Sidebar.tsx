"use client";

import type { ReactNode } from "react";

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface SidebarProps {
  items: NavItem[];
  /** Items pinned to the bottom of the sidebar. */
  bottomItems?: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

function NavButton({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      }`}
    >
      <span
        className={
          active
            ? "text-indigo-600 dark:text-indigo-400"
            : "text-slate-400 dark:text-slate-500"
        }
      >
        {item.icon}
      </span>
      {item.label}
    </button>
  );
}

/**
 * Left navigation. Top items render under "Workspace"; bottomItems are pinned
 * to the lower-left, above the version footer.
 */
export default function Sidebar({
  items,
  bottomItems = [],
  activeId,
  onSelect,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-sm">
          YSR
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            YourSpotRented
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Facility Monitoring Tool
          </p>
        </div>
      </div>

      <p className="px-5 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
        Workspace
      </p>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {items.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={item.id === activeId}
            onSelect={onSelect}
          />
        ))}
      </nav>

      {bottomItems.length > 0 && (
        <nav className="flex flex-col gap-1 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
          {bottomItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={item.id === activeId}
              onSelect={onSelect}
            />
          ))}
        </nav>
      )}

      <div className="border-t border-slate-200 px-5 py-3 dark:border-slate-800">
        <p className="text-xs text-slate-400 dark:text-slate-600">
          v0.4 · YourSpotRented
        </p>
      </div>
    </aside>
  );
}
