/**
 * Minimal RFC 4180 CSV for imports and exports (FND-7). Accepts `,` or `;` as the
 * delimiter: Excel in the Indonesian locale saves with `;` and decimal commas. Quoted
 * fields may contain delimiters, quotes ("") and line breaks. A UTF-8 BOM is ignored.
 */

export interface ParsedCsv {
  delimiter: "," | ";";
  header: string[];
  /** Data rows with their 1-based line number in the file (header is line 1). */
  rows: { line: number; values: Record<string, string> }[];
}

export class CsvError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

function detectDelimiter(firstLine: string): "," | ";" {
  const count = (c: string) => firstLine.split(c).length - 1;
  return count(";") > count(",") ? ";" : ",";
}

function splitRecords(text: string, delimiter: string): { line: number; fields: string[] }[] {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delimiter) {
      fields.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = "";
      line++;
      recordLine = line;
    } else {
      field += c;
    }
  }
  if (quoted) throw new CsvError(recordLine, "unclosed quote");
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }
  return records;
}

export function parseCsv(input: string, opts: { maxRows?: number } = {}): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const records = splitRecords(text, delimiter).filter((r) => r.fields.some((f) => f.trim() !== ""));
  if (records.length === 0) throw new CsvError(1, "the file is empty");
  const header = records[0]!.fields.map((h) => h.trim().toLowerCase());
  const duplicate = header.find((h, i) => header.indexOf(h) !== i);
  if (duplicate) throw new CsvError(1, `column "${duplicate}" appears twice`);
  const data = records.slice(1);
  if (opts.maxRows !== undefined && data.length > opts.maxRows) throw new CsvError(1, `at most ${opts.maxRows} rows per file`);
  return {
    delimiter,
    header,
    rows: data.map((r) => {
      if (r.fields.length > header.length) throw new CsvError(r.line, `has ${r.fields.length} fields, the header has ${header.length}`);
      return { line: r.line, values: Object.fromEntries(header.map((h, i) => [h, (r.fields[i] ?? "").trim()])) };
    }),
  };
}

/** A decimal as typed: "2,5" means 2.5 when the file uses ";" (Indonesian Excel). */
export function normaliseDecimal(value: string, delimiter: "," | ";"): string {
  return delimiter === ";" ? value.replace(",", ".") : value;
}

function escapeField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Leading = + - @ would run as a formula in Excel (CSV injection); prefix a quote.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /["\r\n]/.test(safe) || safe.includes(delimiter) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][], delimiter: "," | ";" = ","): string {
  return [header, ...rows].map((row) => row.map((v) => escapeField(v, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}
