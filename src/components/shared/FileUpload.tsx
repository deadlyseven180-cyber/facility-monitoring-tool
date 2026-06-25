"use client";

import { useRef, useState } from "react";
import { parseCsvFile, CsvParseError } from "@/lib/csv";
import type { ParsedCsv } from "@/types/data";

interface FileUploadProps {
  label?: string;
  /** Called with the parsed CSV once a valid file is read. */
  onParsed: (data: ParsedCsv) => void;
  /** Called when the user clears the current file. */
  onClear?: () => void;
  /** The currently loaded file (controlled), if any. */
  value?: ParsedCsv | null;
  /**
   * Optional extra validation run after parsing (e.g. filename rules).
   * Return an error message to reject the file, or null to accept it.
   */
  validate?: (data: ParsedCsv) => string | null;
}

/**
 * Drag-and-drop + click CSV uploader with loading and error states.
 * Parsing happens in the browser; the parent receives a ParsedCsv.
 */
export default function FileUpload({
  label,
  onParsed,
  onClear,
  value,
  validate,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setLoading(true);
    try {
      const parsed = await parseCsvFile(file);
      const validationError = validate?.(parsed) ?? null;
      if (validationError) {
        setError(validationError);
        return;
      }
      onParsed(parsed);
    } catch (e) {
      const msg =
        e instanceof CsvParseError
          ? e.message
          : "Something went wrong reading that file.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function clear() {
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
    onClear?.();
  }

  return (
    <div>
      {label && (
        <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </p>
      )}

      {value ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-center gap-3">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-emerald-600"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <div className="leading-tight">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {value.fileName}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {value.rows.length} rows · {value.headers.length} columns
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={clear}
            className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragging
              ? "border-indigo-400 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-500/10"
              : "border-slate-300 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/5"
          }`}
        >
          {loading ? (
            <Spinner />
          ) : (
            <svg
              width="28"
              height="28"
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
            {loading ? "Parsing…" : "Drop a CSV here or click to browse"}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            .csv files only
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
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
  );
}
