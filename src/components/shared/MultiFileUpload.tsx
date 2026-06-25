"use client";

import { useRef, useState } from "react";
import { parseCsvFile, CsvParseError } from "@/lib/csv";
import { fileDateRangeKey } from "@/lib/reports/columns";
import type { ParsedCsv } from "@/types/data";

interface MultiFileUploadProps {
  label?: string;
  /** Currently accepted files. */
  value: ParsedCsv[];
  onChange: (files: ParsedCsv[]) => void;
  /** Optional per-file validation; return an error message to reject. */
  validate?: (data: ParsedCsv) => string | null;
  /** Reject a file whose date coverage matches an already-uploaded file. */
  checkDuplicateDateRange?: boolean;
}

function dupeDateRange(file: ParsedCsv, existing: ParsedCsv[]): boolean {
  const key = fileDateRangeKey(file.headers, file.rows);
  if (!key) return false;
  return existing.some((f) => fileDateRangeKey(f.headers, f.rows) === key);
}

/** Drag-and-drop uploader that accepts multiple CSV files. */
export default function MultiFileUpload({
  label,
  value,
  onChange,
  validate,
  checkDuplicateDateRange,
}: MultiFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setLoading(true);
    const added: ParsedCsv[] = [];
    const errs: string[] = [];
    for (const file of files) {
      try {
        const parsed = await parseCsvFile(file);
        const existing = value.concat(added);
        const err = validate?.(parsed) ?? null;
        if (err) {
          errs.push(`${file.name}: ${err}`);
        } else if (existing.some((f) => f.fileName === parsed.fileName)) {
          errs.push("This file has already been uploaded.");
        } else if (checkDuplicateDateRange && dupeDateRange(parsed, existing)) {
          errs.push("This reporting period has already been uploaded.");
        } else {
          added.push(parsed);
        }
      } catch (e) {
        errs.push(
          `${file.name}: ${e instanceof CsvParseError ? e.message : "could not read file."}`,
        );
      }
    }
    if (added.length) onChange([...value, ...added]);
    setErrors(errs);
    setLoading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div>
      {label && (
        <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </p>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors ${
          dragging
            ? "border-indigo-400 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-500/10"
            : "border-slate-300 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/5"
        }`}
      >
        {loading ? (
          <svg
            className="h-7 w-7 animate-spin text-indigo-500"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z"
            />
          </svg>
        ) : (
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-slate-400"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        )}
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {loading ? "Parsing…" : "Drop CSV files here or click to browse"}
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          You can add multiple .csv files
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
        }}
      />

      {value.length > 0 && (
        <ul className="mt-3 space-y-2">
          {value.map((f, i) => (
            <li
              key={`${f.fileName}-${i}`}
              className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {f.fileName}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {f.rows.length} rows · {f.headers.length} columns
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="shrink-0 text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <div className="mt-2 space-y-1">
          {errors.map((e, i) => (
            <p
              key={i}
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
            >
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
