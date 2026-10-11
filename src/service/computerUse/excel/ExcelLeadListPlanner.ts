/**
 * W-1 Excel lead-list planning (design §6.3, PRD §3.1).
 *
 * Pure logic for the qualified workflow: column mapping (unmatched or
 * ambiguous columns are asked, never guessed), TSV construction with the
 * formula-injection guard, Text-format column detection (phone / postal /
 * ID columns before entry so Excel cannot strip leading zeros or coerce
 * values), and whitespace-normalizing read-back comparison that reports
 * mismatches by row and column.
 *
 * Cell values are untrusted text (CU-PERM-07): they never expand authority.
 */

/** Lead fields W-1 knows how to place (PRD W1-3). */
export const LEAD_FIELD_NAMES = [
  "name",
  "company",
  "title",
  "email",
  "phone",
  "website",
  "address",
  "source",
  "collected_date",
] as const;

export type LeadField = (typeof LEAD_FIELD_NAMES)[number];

/** One lead record; values are plain strings from search/extraction results. */
export type LeadRow = Partial<Record<LeadField, string>>;

export interface ColumnMappingQuestion {
  readonly kind: "unmatched" | "ambiguous";
  readonly field: LeadField;
  readonly candidates: readonly string[];
}

export interface ColumnMapping {
  /** lead field -> sheet column index (0-based). */
  readonly assignments: ReadonlyMap<LeadField, number>;
  readonly questions: readonly ColumnMappingQuestion[];
}

/** Normalize a header for matching: trim, lowercase, collapse spaces/underscores. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

const FIELD_ALIASES: Record<LeadField, readonly string[]> = {
  name: ["name", "fullname", "contactname", "leadname", "姓名"],
  company: ["company", "companyname", "organization", "organisation", "business", "公司"],
  title: ["title", "jobtitle", "position", "role", "职位"],
  email: ["email", "emailaddress", "mail", "邮箱"],
  phone: ["phone", "phonenumber", "telephone", "mobile", "tel", "电话"],
  website: ["website", "url", "web", "site", "homepage", "网址"],
  address: ["address", "street", "location", "地址"],
  source: ["source", "leadsource", "channel", "来源"],
  collected_date: ["collecteddate", "datecollected", "collectedat", "date", "采集日期"],
};

/**
 * Match lead fields to sheet headers. Exact (normalized) matches win;
 * multiple equally-good headers for one field is an ambiguity QUESTION, and
 * a field with no candidate is an unmatched QUESTION. The planner never
 * guesses (W1-3: "Unmatched or ambiguous columns are asked, never guessed").
 */
export function mapColumns(
  headers: readonly string[]
): ColumnMapping {
  const assignments = new Map<LeadField, number>();
  const questions: ColumnMappingQuestion[] = [];
  const normalized = headers.map((header, index) => ({
    index,
    header,
    normalized: normalizeHeader(header),
  }));

  // Pass 1: exact alias matches.
  const usedColumns = new Set<number>();
  for (const field of LEAD_FIELD_NAMES) {
    const aliases = FIELD_ALIASES[field];
    const exact = normalized.filter(
      (h) => aliases.includes(h.normalized) && !usedColumns.has(h.index)
    );
    if (exact.length === 1) {
      assignments.set(field, exact[0].index);
      usedColumns.add(exact[0].index);
    } else if (exact.length > 1) {
      questions.push({
        kind: "ambiguous",
        field,
        candidates: exact.map((h) => h.header),
      });
    }
  }

  // Pass 2: substring matches for still-unassigned fields.
  for (const field of LEAD_FIELD_NAMES) {
    if (assignments.has(field)) continue;
    if (questions.some((q) => q.field === field)) continue;
    const aliases = FIELD_ALIASES[field];
    const partial = normalized.filter(
      (h) =>
        !usedColumns.has(h.index) &&
        aliases.some(
          (alias) =>
            h.normalized.includes(alias) || alias.includes(h.normalized)
        ) &&
        h.normalized.length >= 3
    );
    if (partial.length === 1) {
      assignments.set(field, partial[0].index);
      usedColumns.add(partial[0].index);
    } else if (partial.length > 1) {
      questions.push({
        kind: "ambiguous",
        field,
        candidates: partial.map((h) => h.header),
      });
    } else {
      questions.push({ kind: "unmatched", field, candidates: [] });
    }
  }

  return { assignments, questions };
}

/**
 * Formula-injection guard (design §6.3): cells starting with =, +, -, or @
 * get an apostrophe prefix so pasted lead data can never become a formula.
 */
export function guardFormulaInjection(value: string): string {
  if (/^[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/** Column header names that must be set to Text format before entry (W1-4). */
const TEXT_FORMAT_HEADER_PATTERNS: readonly RegExp[] = [
  /phone|tel|mobile/i,
  /postal|zip/i,
  /\bid\b|identifier| guid$/i,
];

/** Value shapes that betray Excel auto-formatting damage (W1-4 risk table). */
function looksAutoFormatted(header: string, sampleValues: readonly string[]): boolean {
  if (TEXT_FORMAT_HEADER_PATTERNS.some((pattern) => pattern.test(header))) {
    return true;
  }
  // Long digit-only values (IDs) lose precision as numbers.
  const longNumeric = sampleValues.filter(
    (v) => /^\d{10,}$/.test(v.trim())
  ).length;
  return longNumeric >= Math.max(1, Math.ceil(sampleValues.length / 2));
}

/**
 * Detect which sheet columns must be set to Text format before paste so
 * Excel does not strip leading zeros or convert values to numbers/dates.
 */
export function detectTextFormatColumns(
  headers: readonly string[],
  sampleValuesByColumn: readonly (readonly string[])[]
): number[] {
  const out: number[] = [];
  for (let index = 0; index < headers.length; index++) {
    if (looksAutoFormatted(headers[index], sampleValuesByColumn[index] ?? [])) {
      out.push(index);
    }
  }
  return out;
}

/**
 * Build the tab-separated rows placed on the clipboard (W1-5). Cells are
 * formula-guarded; the paste itself selects the first empty cell.
 */
export function buildTsvRows(
  leads: readonly LeadRow[],
  mapping: ReadonlyMap<LeadField, number>,
  columnCount: number
): string {
  const columnFields: (LeadField | null)[] = new Array(columnCount).fill(null);
  for (const [field, index] of mapping) {
    if (index < columnCount) columnFields[index] = field;
  }
  return leads
    .map((lead) =>
      columnFields
        .map((field) =>
          field && lead[field] !== undefined
            ? guardFormulaInjection(String(lead[field]))
            : ""
        )
        .join("\t")
    )
    .join("\n");
}

/** One read-back mismatch, reported by row and column (design §6.3). */
export interface ReadbackMismatch {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly header: string;
  readonly expected: string;
  readonly actual: string;
}

/** Normalize a cell for comparison: trim and collapse internal whitespace. */
export function normalizeCell(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Compare pasted rows against the source after normalization. Verification
 * detects every injected cell mismatch (PRD hard gate): any mismatch is
 * reported; the run never reports success with a known mismatch.
 */
export function verifyReadback(
  expectedLeads: readonly LeadRow[],
  mapping: ReadonlyMap<LeadField, number>,
  headers: readonly string[],
  actualCells: readonly (readonly string[])[]
): { ok: boolean; mismatches: readonly ReadbackMismatch[] } {
  const mismatches: ReadbackMismatch[] = [];
  const columnFields: (LeadField | null)[] = new Array(headers.length).fill(null);
  for (const [field, index] of mapping) {
    if (index < headers.length) columnFields[index] = field;
  }
  for (let rowIndex = 0; rowIndex < expectedLeads.length; rowIndex++) {
    const lead = expectedLeads[rowIndex];
    const actualRow = actualCells[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < columnFields.length; columnIndex++) {
      const field = columnFields[columnIndex];
      const expectedRaw = field ? lead[field] : undefined;
      if (expectedRaw === undefined) continue;
      const expected = normalizeCell(guardFormulaInjection(String(expectedRaw)));
      const actual = normalizeCell(String(actualRow[columnIndex] ?? ""));
      if (expected !== actual) {
        mismatches.push({
          rowIndex,
          columnIndex,
          header: headers[columnIndex] ?? `column ${columnIndex + 1}`,
          expected: String(expectedRaw),
          actual: String(actualRow[columnIndex] ?? ""),
        });
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
