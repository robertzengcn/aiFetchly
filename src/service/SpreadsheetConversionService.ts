import * as chardet from "chardet";
import * as iconv from "iconv-lite";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { HtmlConversionService } from "@/service/HtmlConversionService";

/** Maximum rows per sheet for AI Chat attachments (keeps context small). */
export const CHAT_MAX_ROWS = 100;

/** Maximum rows per sheet for RAG Knowledge Library ingestion. */
export const RAG_MAX_ROWS = 10_000;

export interface SpreadsheetConversionOptions {
  maxRowsPerSheet: number;
  normalizeColumns: boolean;
}

/**
 * Centralised conversion of CSV / XLSX buffers to Markdown.
 *
 * Both DocumentService (chat attachments) and ChunkingService (RAG ingestion)
 * delegate to this class so that the conversion logic lives in exactly one
 * place.
 */
export class SpreadsheetConversionService {
  private htmlConversionService: HtmlConversionService;

  constructor() {
    this.htmlConversionService = new HtmlConversionService();
  }

  // ── CSV ──────────────────────────────────────────────────────────────

  /**
   * Convert a CSV buffer to a Markdown table string.
   *
   * @param buffer  Raw CSV bytes (encoding auto-detected).
   * @param opts    Conversion options (row cap, column normalization).
   * @returns       Markdown table, or empty string when the buffer is empty /
   *                contains no parseable rows.
   * @throws        Error when PapaParse reports critical parse errors.
   */
  convertCsvBufferToMarkdown(
    buffer: Buffer,
    opts: SpreadsheetConversionOptions
  ): string {
    const raw = this.decodeBufferToString(buffer).trim();
    if (!raw) {
      return "";
    }

    const result = Papa.parse(raw, {
      skipEmptyLines: true,
      header: false,
    });

    if (result.errors && result.errors.length > 0) {
      const critical = result.errors.filter(
        (e) =>
          e.type === "Quotes" ||
          e.type === "FieldMismatch" ||
          e.code === "MissingQuotes"
      );
      if (critical.length > 0) {
        const messages = critical
          .map((e) => `Row ${e.row}: ${e.message}`)
          .join("; ");
        throw new Error(`CSV parse error: ${messages}`);
      }
      // Recoverable errors — log warnings but continue
      console.warn(
        "CSV parse warnings:",
        result.errors.map((e) => e.message).join("; ")
      );
    }

    if (!result.data || result.data.length === 0) {
      return "";
    }

    let rows = result.data as string[][];
    rows = this.normalizeAndCapRows(rows, opts);

    const header = rows[0];
    const body = rows.slice(1);

    const escapeCell = (value: string): string =>
      String(value).replace(/\|/g, "\\|");

    const headerLine = `| ${header.map(escapeCell).join(" | ")} |`;
    const dividerLine = `| ${header.map(() => "---").join(" | ")} |`;
    const bodyLines = body.map(
      (row) => `| ${row.map(escapeCell).join(" | ")} |`
    );
    return [headerLine, dividerLine, ...bodyLines].join("\n");
  }

  // ── XLSX ─────────────────────────────────────────────────────────────

  /**
   * Convert an XLSX buffer to a Markdown string (one section per sheet).
   *
   * @param buffer  Raw XLSX bytes.
   * @param opts    Conversion options (row cap, column normalization).
   * @returns       Markdown with `## Sheet: <name>` headings, or empty
   *                string when the workbook contains no data.
   */
  convertXlsxBufferToMarkdown(
    buffer: Buffer,
    opts: SpreadsheetConversionOptions
  ): string {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return "";
    }

    const sheetMarkdowns: string[] = [];

    for (const rawSheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[rawSheetName];
      if (!worksheet) continue;

      // Cap rows by adjusting the worksheet range
      if (opts.maxRowsPerSheet > 0) {
        const rangeRef = worksheet["!ref"];
        if (rangeRef) {
          const range = XLSX.utils.decode_range(rangeRef);
          const maxEndRow = Math.min(range.e.r, opts.maxRowsPerSheet);
          const cappedRef = XLSX.utils.encode_range({
            s: range.s,
            e: { r: maxEndRow, c: range.e.c },
          });
          worksheet["!ref"] = cappedRef;
        }
      }

      // Skip sheets with no defined range (completely empty)
      if (!worksheet["!ref"]) continue;

      const html = XLSX.utils.sheet_to_html(worksheet);
      if (!html || !html.trim()) continue;

      const markdown = this.htmlConversionService.convertHtmlToMarkdown(html);
      if (markdown.trim()) {
        const safeName = this.sanitizeSheetName(rawSheetName);
        sheetMarkdowns.push(`## Sheet: ${safeName}\n\n${markdown.trim()}`);
      }
    }

    return sheetMarkdowns.join("\n\n");
  }

  // ── Encoding detection (CSV only — XLSX is always UTF-8 internally) ──

  /**
   * Detect the encoding of a buffer (inspects first 8 KB) and transcode to
   * UTF-8 when necessary.  Falls back to UTF-8 when detection is uncertain.
   */
  decodeBufferToString(buffer: Buffer): string {
    const sample = buffer.subarray(0, 8192);
    const detected = chardet.detect(sample);

    if (
      !detected ||
      detected.toLowerCase() === "utf-8" ||
      detected.toLowerCase() === "ascii"
    ) {
      return buffer.toString("utf-8");
    }

    if (iconv.encodingExists(detected)) {
      return iconv.decode(buffer, detected);
    }

    // Unknown encoding — fall back to UTF-8
    console.warn(
      `Unsupported encoding detected (${detected}), falling back to UTF-8`
    );
    return buffer.toString("utf-8");
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  /**
   * Normalize columns (pad / truncate rows to header count) and cap the
   * total number of rows to `opts.maxRowsPerSheet`.
   */
  private normalizeAndCapRows(
    rows: string[][],
    opts: SpreadsheetConversionOptions
  ): string[][] {
    if (rows.length === 0) return rows;

    const headerCount = rows[0].length;
    let result = rows;

    if (opts.normalizeColumns) {
      result = result.map((row) => this.normalizeRowToWidth(row, headerCount));
    }

    // Cap: +1 to account for the header row itself
    if (opts.maxRowsPerSheet > 0 && result.length > opts.maxRowsPerSheet + 1) {
      result = [result[0], ...result.slice(1, opts.maxRowsPerSheet + 1)];
    }

    return result;
  }

  /**
   * Pad a row with empty strings or truncate it so it exactly matches
   * `targetWidth`.
   */
  private normalizeRowToWidth(row: string[], targetWidth: number): string[] {
    if (row.length === targetWidth) return row;
    if (row.length < targetWidth) {
      return [...row, ...new Array<string>(targetWidth - row.length).fill("")];
    }
    return row.slice(0, targetWidth);
  }

  /**
   * Strip characters from a sheet name that could activate Markdown
   * formatting (e.g. `#`, `*`, `_`, `[`, `]`).
   */
  private sanitizeSheetName(name: string): string {
    // Inside character class: [ is literal, ] needs escaping
    return name.replace(/[#*_[\]]/g, "").trim() || "Sheet";
  }
}
