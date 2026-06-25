"use client";

import { useState } from "react";
import Sidebar, { type NavItem } from "./Sidebar";
import TopBar from "./TopBar";
import GatherData from "@/components/gather/GatherData";
import FacilityProgressChecker from "@/components/progress/FacilityProgressChecker";
import DailyParkers from "@/components/dailyparkers/DailyParkers";
import DailyParkersSync from "@/components/dailyparkers/DailyParkersSync";
import Settings from "@/components/settings/Settings";

// Adding a future tool = one entry here + one component + one case in renderTool().
const NAV_ITEMS: NavItem[] = [
  {
    id: "gather",
    label: "Gather Data",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3v18h18" />
        <rect x="7" y="11" width="3" height="6" />
        <rect x="12" y="7" width="3" height="10" />
        <rect x="17" y="13" width="3" height="4" />
      </svg>
    ),
  },
  {
    id: "progress",
    label: "Facility Progress Checker",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
      </svg>
    ),
  },
];

// Pinned to the lower-left of the sidebar.
const BOTTOM_ITEMS: NavItem[] = [
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export default function AppShell() {
  const [activeId, setActiveId] = useState<string>("gather");
  const activeLabel =
    [...NAV_ITEMS, ...BOTTOM_ITEMS].find((i) => i.id === activeId)?.label ??
    "Workspace";

  function renderTool() {
    switch (activeId) {
      case "gather":
        return <GatherData />;
      case "progress":
        return <FacilityProgressChecker />;
      case "dailyparkers":
        return <DailyParkers />;
      case "settings":
        return <Settings />;
      default:
        return null;
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Hidden background poller: keeps Daily Parkers data synced from Gmail. */}
      <DailyParkersSync />
      <Sidebar
        items={NAV_ITEMS}
        bottomItems={BOTTOM_ITEMS}
        activeId={activeId}
        onSelect={setActiveId}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title={activeLabel} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-8 py-8">{renderTool()}</div>
        </main>
      </div>
    </div>
  );
}
