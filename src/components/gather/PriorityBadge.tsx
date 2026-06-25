import type { PriorityLevel } from "@/types/report";

const STYLES: Record<PriorityLevel, string> = {
  Critical:
    "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  High: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  Medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  Low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

export default function PriorityBadge({ level }: { level: PriorityLevel }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[level]}`}
    >
      {level}
    </span>
  );
}
