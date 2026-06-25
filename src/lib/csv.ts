import Papa from "papaparse";
import type { ParsedCsv } from "@/types/data";

/** Thrown when a file is not a CSV or cannot be parsed. */
export class CsvParseError extends Error {}

function isCsvFile(file: File): boolean {
  const nameOk = file.name.toLowerCase().endsWith(".csv");
  // Some browsers report empty or octet-stream types; rely primarily on extension.
  const typeOk =
    file.type === "" ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel" ||
    file.type === "application/csv";
  return nameOk && typeOk;
}

/**
 * Parse a CSV File entirely in the browser using PapaParse.
 * Values are kept as strings so comparisons are exact and predictable.
 */
export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    if (!isCsvFile(file)) {
      reject(new CsvParseError("Please upload a file with a .csv extension."));
      return;
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = (results.meta.fields ?? []).filter((h) => h.length > 0);

        if (headers.length === 0) {
          reject(
            new CsvParseError(
              "No columns found. The CSV must have a header row.",
            ),
          );
          return;
        }

        // PapaParse reports per-row issues in results.errors; surface a fatal one
        // only if it prevented any data from being read.
        const fatal = results.errors.find((e) => e.type === "Delimiter");
        if (fatal) {
          reject(
            new CsvParseError(
              `Could not parse CSV: ${fatal.message}`,
            ),
          );
          return;
        }

        // Normalize: ensure every row has every header as a string.
        const rows = results.data.map((raw) => {
          const row: Record<string, string> = {};
          for (const h of headers) {
            const v = raw[h];
            row[h] = v == null ? "" : String(v);
          }
          return row;
        });

        resolve({ headers, rows, fileName: file.name });
      },
      error: (err) => {
        reject(new CsvParseError(err.message || "Failed to read the file."));
      },
    });
  });
}

/** Combine multiple parsed CSVs into one (union of headers, concatenated rows). */
export function combineCsvs(files: ParsedCsv[]): ParsedCsv | null {
  if (files.length === 0) return null;
  if (files.length === 1) return files[0];
  const headers: string[] = [];
  for (const f of files) {
    for (const h of f.headers) if (!headers.includes(h)) headers.push(h);
  }
  const rows = files.flatMap((f) =>
    f.rows.map((r) => {
      const row: Record<string, string> = {};
      for (const h of headers) row[h] = r[h] ?? "";
      return row;
    }),
  );
  return { headers, rows, fileName: files.map((f) => f.fileName).join(", ") };
}

/** Serialize rows back to a CSV string for export. */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  return Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) });
}

/** Trigger a client-side download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
