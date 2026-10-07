import { describe, expect, test } from "bun:test";
import { CsvError, normaliseDecimal, parseCsv, toCsv } from "../src/csv";

describe("csv", () => {
  test("parses quotes, embedded delimiters, line breaks and CRLF", () => {
    const parsed = parseCsv('sku,brand_name,note\r\nA1,"Panadol, Biru","line one\nline two"\r\nA2,"Say ""hi""",\r\n');
    expect(parsed.delimiter).toBe(",");
    expect(parsed.rows).toEqual([
      { line: 2, values: { sku: "A1", brand_name: "Panadol, Biru", note: "line one\nline two" } },
      { line: 4, values: { sku: "A2", brand_name: 'Say "hi"', note: "" } },
    ]);
  });

  test("detects ; from Indonesian Excel and reads decimal commas", () => {
    const parsed = parseCsv("﻿SKU;Qty\nA1;2,5\n");
    expect(parsed.delimiter).toBe(";");
    expect(parsed.header).toEqual(["sku", "qty"]);
    expect(normaliseDecimal(parsed.rows[0]!.values.qty!, parsed.delimiter)).toBe("2.5");
  });

  test("skips blank lines and reports bad files with a line number", () => {
    expect(parseCsv("a,b\n\n1,2\n").rows).toHaveLength(1);
    expect(() => parseCsv("")).toThrow(CsvError);
    expect(() => parseCsv('a,b\n1,"open\n')).toThrow(/unclosed quote/);
    expect(() => parseCsv("a,a\n1,2")).toThrow(/appears twice/);
    try {
      parseCsv("a,b\n1,2,3\n");
    } catch (error) {
      expect((error as CsvError).line).toBe(2);
    }
    expect(() => parseCsv("a\n1\n2\n3\n", { maxRows: 2 })).toThrow(/at most 2/);
  });

  test("writes CSV that round-trips and defuses spreadsheet formulas", () => {
    const text = toCsv(["sku", "name"], [["A1", 'Obat "X", 10 mg'], ["A2", "=HYPERLINK(1)"], ["A3", "-5"]]);
    const back = parseCsv(text).rows.map((r) => r.values);
    expect(back).toEqual([
      { sku: "A1", name: 'Obat "X", 10 mg' },
      { sku: "A2", name: "'=HYPERLINK(1)" },
      { sku: "A3", name: "-5" },
    ]);
  });
});
