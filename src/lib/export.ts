import * as XLSX from "xlsx";

export type ExportFormat = "csv" | "xlsx";

export type ExportRow = Record<string, string | number>;

/**
 * Export a table of rows to CSV or Excel (.xlsx) and trigger a download.
 * `columns` fixes the column order and which keys are included.
 */
export function exportTable(
  baseName: string,
  columns: string[],
  rows: ExportRow[],
  format: ExportFormat,
  sheetName = "Sheet1",
): void {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${baseName}.${format}`, {
    bookType: format === "xlsx" ? "xlsx" : "csv",
  });
}
