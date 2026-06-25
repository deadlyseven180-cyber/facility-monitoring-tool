// Maps the "SpotHero City" value to a US state/territory abbreviation.
// Business rule: a facility whose SpotHero City is Boston belongs to MA.
// Extend this map as more markets are added; unmapped cities fall back to the
// MA State / facility-id column.

export const CITY_TO_STATE: Record<string, string> = {
  boston: "MA",
  cambridge: "MA",
  chicago: "IL",
  washington: "DC",
  "washington dc": "DC",
  "new york": "NY",
  brooklyn: "NY",
  philadelphia: "PA",
  pittsburgh: "PA",
  "los angeles": "CA",
  "san francisco": "CA",
  "san diego": "CA",
  seattle: "WA",
  denver: "CO",
  atlanta: "GA",
  miami: "FL",
  baltimore: "MD",
  "new orleans": "LA",
  "jersey city": "NJ",
  hoboken: "NJ",
};

/** Returns the mapped state for a city, or null if it isn't mapped. */
export function stateForCity(city: string | undefined | null): string | null {
  if (!city) return null;
  return CITY_TO_STATE[city.trim().toLowerCase()] ?? null;
}
