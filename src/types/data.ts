// Shared data types for the Facility Monitoring Tool.

/** A CSV parsed into headers + string-valued row objects. */
export interface ParsedCsv {
  /** Column names, in file order. */
  headers: string[];
  /** Each row keyed by header. Values are kept as strings for exact comparison. */
  rows: Record<string, string>[];
  /** Original file name, for display. */
  fileName: string;
}

/** A single field that differs between two matched rows. */
export interface FieldDiff {
  column: string;
  oldValue: string;
  newValue: string;
}

/** A row that exists in both datasets but has at least one differing field. */
export interface ChangedRow {
  key: string;
  /** The matching row from Data 2 (the "new" state). */
  row: Record<string, string>;
  changes: FieldDiff[];
}

/** Summary counts for a comparison. */
export interface ComparisonSummary {
  data1Rows: number;
  data2Rows: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

/** Full result of comparing two datasets by a key column. */
export interface ComparisonResult {
  keyColumn: string;
  /** Union of columns across both datasets, in a stable order. */
  columns: string[];
  /** Rows present only in Data 2. */
  added: Record<string, string>[];
  /** Rows present only in Data 1. */
  removed: Record<string, string>[];
  /** Rows present in both, with differences. */
  changed: ChangedRow[];
  /** Rows present in both and identical across shared columns. */
  unchanged: Record<string, string>[];
  summary: ComparisonSummary;
  /** Non-fatal warnings (e.g. duplicate or blank keys). */
  warnings: string[];
}
