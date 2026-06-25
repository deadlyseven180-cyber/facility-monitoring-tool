// Overbooking detection: given parking reservations, find time windows where
// the number of concurrent reservations at a facility exceeds its capacity.

import { resolveColumn } from "@/lib/reports/columns";
import type { ParsedCsv } from "@/types/data";

export interface Reservation {
  rentalId: string;
  facility: string;
  start: number; // epoch ms
  end: number; // epoch ms
  startRaw: string;
  endRaw: string;
}

const WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i;

/** Parse a date/time string to epoch ms, or null. Strips a leading weekday. */
export function parseDateTime(value: string | undefined): number | null {
  if (!value) return null;
  const s = value.trim().replace(WEEKDAY, "");
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Resolve reservation columns and parse rows. Drops rows without start+end. */
export function parseReservations(data: ParsedCsv): {
  reservations: Reservation[];
  skipped: number;
  columns: { rentalId: string | null; facility: string | null; start: string | null; end: string | null };
} {
  const rentalId = resolveColumn(data.headers, ["Rental ID", "RentalID", "Rental", "Reservation ID"]);
  const facility = resolveColumn(data.headers, [
    "Facility",
    "Facility Name",
    "Spot",
    "Location",
    "Garage",
    "Lot",
  ]);
  const startCol = resolveColumn(data.headers, [
    "Reservation Start",
    "Start",
    "Starts",
    "Start Time",
    "Begin",
    "Check In",
  ]);
  const endCol = resolveColumn(data.headers, [
    "Reservation End",
    "End",
    "Ends",
    "End Time",
    "Finish",
    "Check Out",
  ]);

  const reservations: Reservation[] = [];
  let skipped = 0;
  for (const row of data.rows) {
    const start = parseDateTime(startCol ? row[startCol] : undefined);
    const end = parseDateTime(endCol ? row[endCol] : undefined);
    if (start === null || end === null || end <= start) {
      skipped++;
      continue;
    }
    reservations.push({
      rentalId: (rentalId ? row[rentalId] : "") ?? "",
      facility: (facility ? row[facility] : "") ?? "",
      start,
      end,
      startRaw: (startCol ? row[startCol] : "") ?? "",
      endRaw: (endCol ? row[endCol] : "") ?? "",
    });
  }
  return { reservations, skipped, columns: { rentalId, facility, start: startCol, end: endCol } };
}

/** Distinct facility names found in the reservations. */
export function facilityOptions(reservations: Reservation[]): string[] {
  return [...new Set(reservations.map((r) => r.facility).filter(Boolean))].sort();
}

export interface Conflict {
  /** When concurrency first exceeded capacity. */
  at: number;
  /** Reservations active (overlapping) at that moment. */
  reservations: Reservation[];
}

export interface OverbookingResult {
  facility: string;
  capacity: number;
  total: number;
  peakConcurrent: number;
  conflicts: Conflict[];
  overbooked: boolean;
}

/**
 * Detect overbooking via a sweep line over reservation start/end events.
 * A conflict is recorded each time a new reservation pushes the number of
 * concurrent reservations above `capacity`.
 */
export function detectOverbooking(
  reservations: Reservation[],
  facilityQuery: string,
  capacity: number,
): OverbookingResult {
  const q = facilityQuery.trim().toLowerCase();
  const matched = q
    ? reservations.filter((r) => r.facility.toLowerCase().includes(q))
    : reservations;

  type Ev = { t: number; delta: number; r: Reservation };
  const events: Ev[] = [];
  for (const r of matched) {
    events.push({ t: r.start, delta: 1, r });
    events.push({ t: r.end, delta: -1, r });
  }
  // Process ends before starts at the same instant (touching ≠ overlap).
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  const active = new Set<Reservation>();
  let peak = 0;
  const conflicts: Conflict[] = [];
  for (const e of events) {
    if (e.delta === 1) {
      active.add(e.r);
      if (active.size > capacity) {
        conflicts.push({ at: e.t, reservations: [...active] });
      }
    } else {
      active.delete(e.r);
    }
    peak = Math.max(peak, active.size);
  }

  return {
    facility: facilityQuery.trim(),
    capacity,
    total: matched.length,
    peakConcurrent: peak,
    conflicts,
    overbooked: conflicts.length > 0,
  };
}
