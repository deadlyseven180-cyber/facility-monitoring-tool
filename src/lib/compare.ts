import type {
  ChangedRow,
  ComparisonResult,
  FieldDiff,
  ParsedCsv,
} from "@/types/data";

/**
 * Build the union of columns across two datasets, preserving Data 1 order first,
 * then appending any columns unique to Data 2.
 */
function unionColumns(a: ParsedCsv, b: ParsedCsv): string[] {
  const cols = [...a.headers];
  for (const h of b.headers) {
    if (!cols.includes(h)) cols.push(h);
  }
  return cols;
}

/**
 * Index rows by their key-column value. Blank keys are skipped (and counted).
 * On duplicate keys, the last row wins (matching typical "latest record" intent).
 */
function indexByKey(
  data: ParsedCsv,
  keyColumn: string,
): { map: Map<string, Record<string, string>>; blanks: number; dupes: number } {
  const map = new Map<string, Record<string, string>>();
  let blanks = 0;
  let dupes = 0;
  for (const row of data.rows) {
    const key = (row[keyColumn] ?? "").trim();
    if (key === "") {
      blanks++;
      continue;
    }
    if (map.has(key)) dupes++;
    map.set(key, row);
  }
  return { map, blanks, dupes };
}

/**
 * Compare two datasets by a shared key column.
 *
 * - added:     key present only in Data 2
 * - removed:   key present only in Data 1
 * - changed:   key in both, at least one shared column differs
 * - unchanged: key in both, all compared columns equal
 *
 * Comparison runs over the union of columns; a column absent on one side is
 * treated as an empty string.
 */
export function compareByKey(
  data1: ParsedCsv,
  data2: ParsedCsv,
  keyColumn: string,
): ComparisonResult {
  const columns = unionColumns(data1, data2);
  const a = indexByKey(data1, keyColumn);
  const b = indexByKey(data2, keyColumn);

  const added: Record<string, string>[] = [];
  const removed: Record<string, string>[] = [];
  const changed: ChangedRow[] = [];
  const unchanged: Record<string, string>[] = [];

  // Rows in Data 1: removed or matched (changed/unchanged).
  for (const [key, row1] of a.map) {
    const row2 = b.map.get(key);
    if (!row2) {
      removed.push(row1);
      continue;
    }
    const changes: FieldDiff[] = [];
    for (const col of columns) {
      if (col === keyColumn) continue;
      const oldValue = row1[col] ?? "";
      const newValue = row2[col] ?? "";
      if (oldValue !== newValue) {
        changes.push({ column: col, oldValue, newValue });
      }
    }
    if (changes.length > 0) {
      changed.push({ key, row: row2, changes });
    } else {
      unchanged.push(row2);
    }
  }

  // Rows in Data 2 not in Data 1: added.
  for (const [key, row2] of b.map) {
    if (!a.map.has(key)) added.push(row2);
  }

  const warnings: string[] = [];
  if (a.blanks > 0)
    warnings.push(
      `Data 1 has ${a.blanks} row(s) with a blank "${keyColumn}" — skipped.`,
    );
  if (b.blanks > 0)
    warnings.push(
      `Data 2 has ${b.blanks} row(s) with a blank "${keyColumn}" — skipped.`,
    );
  if (a.dupes > 0)
    warnings.push(
      `Data 1 has ${a.dupes} duplicate "${keyColumn}" value(s) — last row used.`,
    );
  if (b.dupes > 0)
    warnings.push(
      `Data 2 has ${b.dupes} duplicate "${keyColumn}" value(s) — last row used.`,
    );

  return {
    keyColumn,
    columns,
    added,
    removed,
    changed,
    unchanged,
    summary: {
      data1Rows: data1.rows.length,
      data2Rows: data2.rows.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged: unchanged.length,
    },
    warnings,
  };
}

/** Columns shared by both datasets — candidates for a key column. */
export function commonColumns(a: ParsedCsv, b: ParsedCsv): string[] {
  return a.headers.filter((h) => b.headers.includes(h));
}
