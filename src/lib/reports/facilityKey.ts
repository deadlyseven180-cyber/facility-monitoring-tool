// Facility-name canonicalization + state helpers, shared by the analysis
// engine and the facility→state API. Two facility labels that differ only by
// case, punctuation, or spacing ("… #3 or 6 ONLY" vs "… #3 or 6 Only") collapse
// to the same key so their complaints merge into one row. Distinguishing tokens
// (spot numbers, street numbers) survive, so genuinely different spots stay
// separate.

/**
 * Canonical grouping key for a facility label: lowercased, with every
 * non-alphanumeric character removed. Returns "" for blank input.
 */
export function canonicalFacilityKey(name: string | undefined | null): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Canonical key for just the STREET part of a facility name — everything before
 * the first " - " (which separates the address from the spot/notes). Used as a
 * fallback state match so suffix differences ("(ARCHIVED)", a different list of
 * spot numbers, etc.) still resolve to the right facility. Falls back to the
 * whole name when there's no " - ".
 */
export function canonicalStreetKey(name: string | undefined | null): string {
  const s = name ?? "";
  const i = s.indexOf(" - ");
  return canonicalFacilityKey(i >= 0 ? s.slice(0, i) : s);
}

/** The primary operating markets (used for the report's state filter). */
export const VALID_STATES = ["MA", "IL", "DC"] as const;

/** Every US state + DC abbreviation, so any facility's real state can show. */
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

/** Canadian provinces/territories — some facilities are in Toronto, ON. */
const CA_PROVINCES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

const FULL_NAME_TO_STATE: Record<string, string> = {
  // US states + DC.
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC", "washington dc": "DC",
  // Canadian provinces/territories.
  ontario: "ON", quebec: "QC", "british columbia": "BC", alberta: "AB",
  manitoba: "MB", saskatchewan: "SK", "nova scotia": "NS", "new brunswick": "NB",
  "newfoundland and labrador": "NL", "prince edward island": "PE",
};

/**
 * Normalize a raw state/province value to its 2-letter abbreviation, or null if
 * it isn't a recognizable US state or Canadian province. Accepts abbreviations
 * and a few full names.
 */
export function normalizeState(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const upper = s.toUpperCase();
  if (US_STATES.has(upper) || CA_PROVINCES.has(upper)) return upper;
  return FULL_NAME_TO_STATE[s.toLowerCase()] ?? null;
}

/**
 * Extract the state/province from a free-text facility address. Looks for a
 * 2-letter token immediately preceding either a US ZIP (e.g. "…, Boston, MA
 * 02215") or a Canadian postal code (e.g. "… Toronto, ON, M5V 2G5"). Returns
 * null if none is found.
 */
export function stateFromAddress(address: string | undefined | null): string | null {
  if (!address) return null;
  const up = address.toUpperCase();
  // US: 2-letter state before a 5-digit ZIP.
  const usm = up.match(/\b([A-Z]{2})\b(?=[,\s]*\d{5})/);
  if (usm?.[1] && US_STATES.has(usm[1])) return usm[1];
  // Canada: 2-letter province before a postal code (forward sortation area "A1A").
  const cam = up.match(/\b([A-Z]{2})\b(?=[,\s]*[A-Z]\d[A-Z])/);
  if (cam?.[1] && CA_PROVINCES.has(cam[1])) return cam[1];
  // Spelled-out state/province name just before a ZIP, postal code, "Canada", or
  // end of string — e.g. "… Baltimore, Maryland 21218", "… Ontario, Canada".
  for (const [name, abbr] of Object.entries(FULL_NAME_TO_STATE)) {
    const re = new RegExp(`\\b${name.toUpperCase().replace(/ /g, "\\s+")}\\b(?=[,\\s]*(?:\\d{5}|[A-Z]\\d[A-Z]|CANADA|$))`);
    if (re.test(up)) return abbr;
  }
  // Bare province abbreviation anywhere in an explicitly-Canadian address.
  if (/\bCANADA\b/.test(up)) {
    const prov = up.match(/\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/);
    if (prov?.[1]) return prov[1];
  }
  return null;
}
