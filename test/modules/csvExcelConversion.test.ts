"use strict";
import { describe, it } from "mocha";
import { expect } from "chai";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { HtmlConversionService } from "@/service/HtmlConversionService";

/**
 * Tests for CSV and Excel to markdown conversion pipeline.
 *
 * T012: CSV to markdown (papaparse-based)
 * T013: Excel to markdown (xlsx + turndown pipeline)
 * T014: Row capping for chat attachments (100 rows/sheet)
 */

describe("CSV and Excel Conversion Pipeline", () => {
  const htmlConversionService = new HtmlConversionService();

  // Helper: convert CSV string to markdown table (mirrors ChunkingService logic)
  function csvToMarkdown(csvRaw: string): string {
    const trimmed = csvRaw.trim();
    if (!trimmed) return "";
    const result = Papa.parse(trimmed, { skipEmptyLines: true, header: false });
    if (!result.data || result.data.length === 0) return "";
    const rows = result.data as string[][];
    const header = rows[0];
    const body = rows.slice(1);
    const escapeCell = (v: string): string => String(v).replace(/\|/g, "\\|");
    return [
      `| ${header.map(escapeCell).join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...body.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    ].join("\n");
  }

  // Helper: convert xlsx buffer to markdown (mirrors DocumentService logic)
  function xlsxToMarkdown(
    buffer: Buffer,
    options?: { maxRowsPerSheet?: number }
  ): string {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) return "";
    const sheetMarkdowns: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      if (options?.maxRowsPerSheet) {
        const rangeRef = worksheet["!ref"];
        if (rangeRef) {
          const range = XLSX.utils.decode_range(rangeRef);
          const maxEndRow = Math.min(range.e.r, options.maxRowsPerSheet);
          const cappedRef = XLSX.utils.encode_range({
            s: range.s,
            e: { r: maxEndRow, c: range.e.c },
          });
          worksheet["!ref"] = cappedRef;
        }
      }

      const html = XLSX.utils.sheet_to_html(worksheet);
      if (!html || !html.trim()) continue;
      const markdown = htmlConversionService.convertHtmlToMarkdown(html);
      if (markdown.trim()) {
        sheetMarkdowns.push(`## Sheet: ${sheetName}\n\n${markdown.trim()}`);
      }
    }
    return sheetMarkdowns.join("\n\n");
  }

  // Helper: create an xlsx buffer from data
  function createXlsxBuffer(
    sheets: Record<string, (string | number)[][]>
  ): Buffer {
    const workbook = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
    }
    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return Buffer.from(buf);
  }

  // ── T012: CSV to markdown ──

  describe("T012: CSV to markdown conversion", () => {
    it("should convert basic CSV with headers and rows", () => {
      const csv = "Name,Age,City\nAlice,30,NYC\nBob,25,LA";
      const md = csvToMarkdown(csv);
      expect(md).to.include("| Name | Age | City |");
      expect(md).to.include("| --- | --- | --- |");
      expect(md).to.include("| Alice | 30 | NYC |");
      expect(md).to.include("| Bob | 25 | LA |");
    });

    it("should handle quoted fields with commas", () => {
      const csv = 'Name,Description\n"Smith, John","A, B, C"';
      const md = csvToMarkdown(csv);
      expect(md).to.include("| Smith, John | A, B, C |");
    });

    it("should handle escaped quotes inside fields", () => {
      const csv = 'Name,Quote\nAlice,"She said ""hello"""';
      const md = csvToMarkdown(csv);
      expect(md).to.include('She said "hello"');
    });

    it("should handle empty CSV", () => {
      expect(csvToMarkdown("")).to.equal("");
      expect(csvToMarkdown("   ")).to.equal("");
    });

    it("should handle header-only CSV (no data rows)", () => {
      const csv = "Col1,Col2,Col3";
      const md = csvToMarkdown(csv);
      expect(md).to.include("| Col1 | Col2 | Col3 |");
      expect(md).to.include("| --- |");
    });

    it("should handle pipe characters in cells by escaping them", () => {
      const csv = 'Formula,Result\n"A | B","x | y"';
      const md = csvToMarkdown(csv);
      expect(md).to.include("A \\| B");
      expect(md).to.include("x \\| y");
    });

    it("should skip empty lines", () => {
      const csv = "A,B\n1,2\n\n3,4";
      const md = csvToMarkdown(csv);
      const lines = md.split("\n");
      // Header + divider + 2 data rows = 4 lines
      expect(lines.length).to.equal(4);
    });
  });

  // ── T013: Excel to markdown ──

  describe("T013: Excel to markdown conversion", () => {
    it("should convert a single-sheet xlsx to markdown", () => {
      const buffer = createXlsxBuffer({
        Sheet1: [
          ["Name", "Score"],
          ["Alice", 95],
          ["Bob", 87],
        ],
      });
      const md = xlsxToMarkdown(buffer);
      expect(md).to.include("## Sheet: Sheet1");
      expect(md).to.include("Alice");
      expect(md).to.include("Bob");
      expect(md).to.include("95");
      expect(md).to.include("87");
    });

    it("should handle multiple sheets with sheet name headers", () => {
      const buffer = createXlsxBuffer({
        Q1: [
          ["Month", "Revenue"],
          ["Jan", 1000],
          ["Feb", 1200],
        ],
        Q2: [
          ["Month", "Revenue"],
          ["Apr", 1500],
          ["May", 1800],
        ],
      });
      const md = xlsxToMarkdown(buffer);
      expect(md).to.include("## Sheet: Q1");
      expect(md).to.include("## Sheet: Q2");
      expect(md).to.include("Jan");
      expect(md).to.include("Apr");
    });

    it("should handle empty workbook gracefully", () => {
      const workbook = XLSX.utils.book_new();
      const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      const buffer = Buffer.from(buf);
      const md = xlsxToMarkdown(buffer);
      expect(md).to.equal("");
    });

    it("should handle sheet with only headers (no data)", () => {
      const buffer = createXlsxBuffer({
        EmptySheet: [["Col1", "Col2", "Col3"]],
      });
      const md = xlsxToMarkdown(buffer);
      expect(md).to.include("## Sheet: EmptySheet");
      expect(md).to.include("Col1");
    });
  });

  // ── T014: Row capping ──

  describe("T014: Row capping for chat attachments", () => {
    it("should cap at 100 rows per sheet when maxRowsPerSheet is set", () => {
      // Create a sheet with 200 rows of data (header + 200 data rows)
      const rows: string[][] = [["ID", "Value"]];
      for (let i = 1; i <= 200; i++) {
        rows.push([`row${i}`, `value${i}`]);
      }
      const buffer = createXlsxBuffer({ Data: rows });
      const md = xlsxToMarkdown(buffer, { maxRowsPerSheet: 100 });

      // Should include row100 but NOT row101+
      expect(md).to.include("row100");
      expect(md).to.not.include("row101");
      expect(md).to.not.include("row200");
    });

    it("should NOT cap rows when no maxRowsPerSheet is set (RAG path)", () => {
      const rows: string[][] = [["ID", "Value"]];
      for (let i = 1; i <= 150; i++) {
        rows.push([`row${i}`, `value${i}`]);
      }
      const buffer = createXlsxBuffer({ Data: rows });
      const md = xlsxToMarkdown(buffer); // No maxRowsPerSheet

      // Should include all rows since no cap
      expect(md).to.include("row150");
    });

    it("should handle file with fewer rows than cap without truncation", () => {
      const rows: string[][] = [["ID", "Value"]];
      for (let i = 1; i <= 50; i++) {
        rows.push([`row${i}`, `value${i}`]);
      }
      const buffer = createXlsxBuffer({ Data: rows });
      const md = xlsxToMarkdown(buffer, { maxRowsPerSheet: 100 });

      // All 50 rows should be present
      expect(md).to.include("row50");
    });
  });
});
