// Priority scoring — kept modular so the formula and thresholds can change
// without touching the analysis engine.

import type { PriorityLevel } from "@/types/report";

export interface ScoreInput {
  incidentCount: number;
  refundTotal: number;
  totalRemit: number;
}

export type ScoreFn = (input: ScoreInput) => number;

/**
 * Default formula:
 *   (incidents × 10) + (refundTotal ÷ 10)
 * Swap this out (or pass a custom ScoreFn to analyzeReport) to change weighting.
 */
export const defaultScoreFn: ScoreFn = ({ incidentCount, refundTotal }) =>
  incidentCount * 10 + refundTotal / 10;

/**
 * Priority level is driven by the number of complaints (Lot Full incidents):
 *   6 or more → Critical   (6–10+)
 *   4 to 5    → High
 *   2 to 3    → Medium
 *   1 or fewer → Low
 * Thresholds are inclusive lower bounds, evaluated high → low.
 */
export const PRIORITY_COUNT_THRESHOLDS: { level: PriorityLevel; min: number }[] =
  [
    { level: "Critical", min: 6 },
    { level: "High", min: 4 },
    { level: "Medium", min: 2 },
    { level: "Low", min: 0 },
  ];

export function priorityLevelFromCount(count: number): PriorityLevel {
  for (const t of PRIORITY_COUNT_THRESHOLDS) {
    if (count >= t.min) return t.level;
  }
  return "Low";
}
