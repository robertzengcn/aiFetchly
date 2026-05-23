"use strict";
import { describe, it } from "mocha";
import { expect } from "chai";
import * as XLSX from "xlsx";
import {
  SpreadsheetConversionService,
  CHAT_MAX_ROWS,
  RAG_MAX_ROWS,
} from "@/service/SpreadsheetConversionService";

/**
 * Tests for the shared SpreadsheetConversionService.
 *
 * Covers: CSV→markdown, XLSX→markdown, row capping (CHAT / RAG),
 * column normalization, encoding detection, error handling,
 * sheet-name sanitization.
 */

describe("SpreadsheetConversionService", () => {
  const service = new SpreadsheetConversionService();

  // ── Helpers ──

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

  const chatOpts = {
    maxRowsPerSheet: CHAT_MAX_ROWS,
    normalizeColumns: true,
  };

  const ragOpts = {
    maxRowsPerSheet: RAG_MAX_ROWS,
    normalizeColumns: true,
  };

  // ── CSV → Markdown ──

  describe("CSV to markdown conversion", () => {
    it("should convert basic CSV with headers and rows", () => {
      const csv = Buffer.from("Name,Age,City\nAlice,30,NYC\nBob,25,LA");
      const md = service.convertCsvBufferToMarkdown(csv, chatOpts);
      expect(md).to.include("| Name | Age | City |");
      expect(md).to.include("| --- | --- | --- |");
      expect(md).to.include("| Alice | 30 | NYC |");
      expect(md).to.include("| Bob | 25 | LA |");
    });

    it("should handle quoted fields with commas", () => {
      const csv = Buffer.from('Name,Description\n"Smith, John","A, B, C"');
      const md = service.convertCsvBufferToMarkdown(csv, chatOpts);
      expect(md).to.include("| Smith, John | A, B, C |");
    });

    it("should handle escaped quotes inside fields", () => {
      const csv = Buffer.from('Name,Quote\nAlice,"She said ""hello"""');
      const md = service.convertCsvBufferToMarkdown(csv, chatOpts);
      expect(md).to.include('She said "hello"');
    });

    it("should handle empty CSV", () => {
      expect(
        service.convertCsvBufferToMarkdown(Buffer.from(""), chatOpts)
      ).to.equal("");
      expect(
        service.convertCsvBufferToMarkdown(Buffer.from("   "), chatOpts)
      ).to.equal("");
    });

    it("should handle header-only CSV (no data rows)", () => {
      const csv = Buffer.from("Col1,Col2,Col3");
      const md = service.convertCsvBufferToMarkdown(csv, chatOpts);
      expect(md).to.include("| Col1 | Col2 | Col3 |");
      expect(md).to.include("| --- |");
    });

    it("should handle pipe characters in cells by escaping them", () => {
      const csv = Buffer.from('Formula,Result\n"A | B","x | y"');
      const md = service.convertCsvBufferToMarkdown(csv, chatOpts);
      expect(md).to.include("A \\| B");
      expect(md).to.include("x \\| y");
    });

    it("should skip empty lines", () => {
      const csv = Buffer.from("A,B\n1,2\n\n3,4");
      const md = service.convertCsvBufferToMarkdown(csv, chatOpts);
      const lines = md.split("\n");
      expect(lines.length).to.equal(4);
    });
  });

  // ── XLSX → Markdown ──

  describe("XLSX to markdown conversion", () => {
    it("should convert a single-sheet xlsx to markdown", () => {
      const buffer = createXlsxBuffer({
        Sheet1: [
          ["Name", "Score"],
          ["Alice", 95],
          ["Bob", 87],
        ],
      });
      const md = service.convertXlsxBufferToMarkdown(buffer, chatOpts);
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
      const md = service.convertXlsxBufferToMarkdown(buffer, chatOpts);
      expect(md).to.include("## Sheet: Q1");
      expect(md).to.include("## Sheet: Q2");
      expect(md).to.include("Jan");
      expect(md).to.include("Apr");
    });

    it("should handle empty workbook gracefully", () => {
      // XLSX.write throws on empty workbook, so create one with an empty sheet
      const workbook = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([]);
      XLSX.utils.book_append_sheet(workbook, ws, "Empty");
      const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      const buffer = Buffer.from(buf);
      const md = service.convertXlsxBufferToMarkdown(buffer, chatOpts);
      expect(md).to.equal("");
    });

    it("should handle sheet with only headers (no data)", () => {
      const buffer = createXlsxBuffer({
        EmptySheet: [["Col1", "Col2", "Col3"]],
      });
      const md = service.convertXlsxBufferToMarkdown(buffer, chatOpts);
      expect(md).to.include("## Sheet: EmptySheet");
      expect(md).to.include("Col1");
    });
  });

  // ── Row capping ──

  describe("Row capping", () => {
    it("should cap at CHAT_MAX_ROWS (100) per sheet for chat attachments", () => {
      const rows: string[][] = [["ID", "Value"]];
      for (let i = 1; i <= 200; i++) {
        rows.push([`row${i}`, `value${i}`]);
      }
      const buffer = createXlsxBuffer({ Data: rows });
      const md = service.convertXlsxBufferToMarkdown(buffer, chatOpts);

      expect(md).to.include("row100");
      expect(md).to.not.include("row101");
      expect(md).to.not.include("row200");
    });

    it("should cap at RAG_MAX_ROWS (10 000) for RAG ingestion", () => {
      const csvLines = ["ID,Value"];
      for (let i = 1; i <= 10_200; i++) {
        csvLines.push(`row${i},value${i}`);
      }
      const csv = Buffer.from(csvLines.join("\n"));
      const md = service.convertCsvBufferToMarkdown(csv, ragOpts);

      expect(md).to.include("row10000");
      expect(md).to.not.include("row10001");
    });

    it("should NOT cap rows when maxRowsPerSheet is very large", () => {
      const rows: string[][] = [["ID", "Value"]];
      for (let i = 1; i <= 150; i++) {
        rows.push([`row${i}`, `value${i}`]);
      }
      const buffer = createXlsxBuffer({ Data: rows });
      const md = service.convertXlsxBufferToMarkdown(buffer, {
        maxRowsPerSheet: RAG_MAX_ROWS,
        normalizeColumns: false,
      });
      expect(md).to.include("row150");
    });

    it("should handle file with fewer rows than cap without truncation", () => {
      const rows: string[][] = [["ID", "Value"]];
      for (let i = 1; i <= 50; i++) {
        rows.push([`row${i}`, `value${i}`]);
      }
      const buffer = createXlsxBuffer({ Data: rows });
      const md = service.convertXlsxBufferToMarkdown(buffer, chatOpts);
      expect(md).to.include("row50");
    });
  });

  // ── Column normalization ──

  describe("Column normalization", () => {
    it("should pad short rows to match header column count", () => {
      const csv = Buffer.from("A,B,C\n1,2\n3,4,5");
      const md = service.convertCsvBufferToMarkdown(csv, {
        maxRowsPerSheet: 1000,
        normalizeColumns: true,
      });
      const lines = md.split("\n");
      // lines[0]=header, lines[1]=divider, lines[2]=first data row
      // "1,2" padded to 3 cols → "| 1 | 2 |  |"
      expect(lines[2]).to.match(/^\|\s*1\s*\|\s*2\s*\|\s*\|\s*$/);
    });

    it("should truncate long rows to match header column count", () => {
      const csv = Buffer.from("A,B\n1,2,3,4");
      const md = service.convertCsvBufferToMarkdown(csv, {
        maxRowsPerSheet: 1000,
        normalizeColumns: true,
      });
      const lines = md.split("\n");
      const dataCells = lines[2].split("|").filter((c) => c.trim() !== "");
      expect(dataCells.length).to.equal(2);
    });
  });

  // ── Encoding detection ──

  describe("Encoding detection (decodeBufferToString)", () => {
    it("should decode UTF-8 buffer as-is", () => {
      const text = "Héllo, wörld!";
      const buf = Buffer.from(text, "utf-8");
      expect(service.decodeBufferToString(buf)).to.equal(text);
    });

    it("should decode ASCII buffer as-is", () => {
      const text = "Hello, world!";
      const buf = Buffer.from(text, "ascii");
      expect(service.decodeBufferToString(buf)).to.equal(text);
    });
  });

  // ── Error handling ──

  describe("Error handling", () => {
    it("should throw on CSV with critical parse errors", () => {
      // Unterminated quote
      const csv = Buffer.from('A,B\n"hello,world');
      expect(() => service.convertCsvBufferToMarkdown(csv, chatOpts)).to.throw(
        /CSV parse error/
      );
    });
  });

  // ── Sheet-name sanitization ──

  describe("Sheet-name sanitization", () => {
    it("should strip markdown-active characters from sheet names", () => {
      const buffer = createXlsxBuffer({
        "My#Sheet_1": [
          ["A", "B"],
          ["1", "2"],
        ],
      });
      const md = service.convertXlsxBufferToMarkdown(buffer, chatOpts);
      expect(md).to.include("## Sheet: MySheet1");
    });

    it("should fallback to 'Sheet' when name is all special chars", () => {
      // XLSX rejects *, [, ] in sheet names — use only chars our sanitizer strips
      const buffer = createXlsxBuffer({
        "#": [
          ["A", "B"],
          ["1", "2"],
        ],
      });
      const md = service.convertXlsxBufferToMarkdown(buffer, chatOpts);
      expect(md).to.include("## Sheet: Sheet");
    });
  });
});
