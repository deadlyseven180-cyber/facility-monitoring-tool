// Rule-based recommendation + action-plan engine for the Facility Progress
// Checker. Deterministic — adapts to the facility's dominant complaint type and
// whether complaints are trending up. Written for executive reporting.

export interface FacilityProfile {
  name: string;
  lotFull: number;
  inaccessibility: number;
  trendUp: boolean; // complaints increasing vs previous period
}

export interface ActionPhase {
  phase: string;
  owner: string;
  dueInDays: number;
  actions: string[];
  expectedOutcome: string;
}
export interface Recommendation {
  focus: "Lot Full" | "Inaccessibility";
  priority: "High" | "Medium" | "Low";
  summary: string;
  rootCauses: string[];
  recommendations: string[];
  expectedImpact: string;
  actionPlan: ActionPhase[];
}

const LOT_FULL_RECS = [
  "Review inventory settings and reduce daily allocation during peak demand",
  "Audit overselling behavior across SpotHero, monthly, and event inventory",
  "Monitor monthly parker occupancy and reconcile against sold inventory",
  "Tighten event-day inventory management and block-out rules",
  "Verify real available inventory on-site vs. what is listed",
];
const LOT_FULL_CAUSES = [
  "Daily reservations exceeding true capacity (overselling)",
  "Monthly parker occupancy not reflected in available inventory",
  "Event-day demand spikes without inventory blocks",
  "Unauthorized / un-towed vehicles occupying sold spaces",
];
const INACC_RECS = [
  "Audit and rewrite the “Getting There” instructions",
  "Improve on-site and approach signage",
  "Update facility photos to match the current entrance/layout",
  "Verify gate codes and access procedures with the operator",
  "Review and correct any access restrictions or seller info",
];
const INACC_CAUSES = [
  "Outdated or unclear “Getting There” directions",
  "Incorrect gate/access codes or procedures",
  "Inaccurate facility photos causing customer confusion",
  "Seller-provided facility information out of date",
];

export function recommendFor(f: FacilityProfile): Recommendation {
  const lotHeavy = f.lotFull >= f.inaccessibility;
  const focus = lotHeavy ? "Lot Full" : "Inaccessibility";
  const total = f.lotFull + f.inaccessibility;
  const priority: Recommendation["priority"] = total >= 10 || f.trendUp ? "High" : total >= 4 ? "Medium" : "Low";

  const summary = lotHeavy
    ? `Lot Full is the dominant driver (${f.lotFull} vs ${f.inaccessibility} inaccessibility). Complaints are ${f.trendUp ? "increasing" : "stable/declining"} — focus on capacity & enforcement.`
    : `Inaccessibility is the dominant driver (${f.inaccessibility} vs ${f.lotFull} lot full). Complaints are ${f.trendUp ? "increasing" : "stable/declining"} — focus on access information & signage.`;

  const expectedImpact = lotHeavy
    ? "Estimated reduction in Lot Full complaints: 15–30%"
    : "Estimated reduction in Inaccessibility complaints: 20–40%";

  const actionPlan: ActionPhase[] = lotHeavy
    ? [
        { phase: "Immediate (0–7 days)", owner: "Operations / Enforcement", dueInDays: 7, expectedOutcome: "Stop active overselling on peak days", actions: ["Verify available inventory on-site", "Cap daily allocation during peak hours", "Initiate towing/enforcement on unauthorized parkers"] },
        { phase: "Short-Term (7–30 days)", owner: "Inventory Manager", dueInDays: 30, expectedOutcome: "Inventory matched to real capacity", actions: ["Reconcile monthly occupancy vs. listed inventory", "Review event-day inventory blocks"] },
        { phase: "Long-Term (30–90 days)", owner: "Account Owner", dueInDays: 90, expectedOutcome: "Sustained Lot Full reduction", actions: ["Re-tune inventory settings", "Confirm sustained reduction vs. baseline and assign a monitoring owner"] },
      ]
    : [
        { phase: "Immediate (0–7 days)", owner: "Facility Content / Audit", dueInDays: 7, expectedOutcome: "Customers can find & enter the facility", actions: ["Audit “Getting There” instructions", "Verify gate codes and access procedures", "Add temporary on-site signage"] },
        { phase: "Short-Term (7–30 days)", owner: "Content / Seller Relations", dueInDays: 30, expectedOutcome: "Accurate facility information live", actions: ["Update facility photos", "Correct seller-provided information and access restrictions"] },
        { phase: "Long-Term (30–90 days)", owner: "Account Owner", dueInDays: 90, expectedOutcome: "Sustained Inaccessibility reduction", actions: ["Re-audit the access experience", "Confirm sustained reduction vs. baseline and assign a monitoring owner"] },
      ];

  return {
    focus,
    priority,
    summary,
    rootCauses: lotHeavy ? LOT_FULL_CAUSES : INACC_CAUSES,
    recommendations: lotHeavy ? LOT_FULL_RECS : INACC_RECS,
    expectedImpact,
    actionPlan,
  };
}
