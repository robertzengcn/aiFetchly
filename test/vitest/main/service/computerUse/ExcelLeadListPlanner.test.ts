// test/vitest/main/service/computerUse/ExcelLeadListPlanner.test.ts
//
// W-1 Excel logic (design §6.3, §14.2): column mapping with ask-on-
// ambiguity, formula-injection guard, Text-format detection, TSV
// construction, whitespace-normalizing read-back diff, and clipboard
// save/restore on success, failure, and stop.
import { describe, it, expect } from "vitest";
import {
  mapColumns,
  guardFormulaInjection,
  detectTextFormatColumns,
  buildTsvRows,
  verifyReadback,
  normalizeHeader,
} from "@/service/computerUse/excel/ExcelLeadListPlanner";
import {
  ComputerUseClipboardService,
  type ClipboardSeam,
} from "@/service/computerUse/ComputerUseClipboardService";

describe("mapColumns", () => {
  it("maps exact headers including Chinese aliases", () => {
    const mapping = mapColumns([
      "Name", "Company", "Email", "Phone Number", "Website", "Address", "Source", "Collected Date", "Job Title",
    ]);
    expect(mapping.questions).toHaveLength(0);
    expect(mapping.assignments.get("name")).toBe(0);
    expect(mapping.assignments.get("phone")).toBe(3);
    expect(mapping.assignments.get("collected_date")).toBe(7);
    expect(mapping.assignments.get("title")).toBe(8);
  });

  it("asks on ambiguous headers instead of guessing", () => {
    const mapping = mapColumns(["Contact Name", "Lead Name", "Email"]);
    const ambiguity = mapping.questions.find(
      (q) => q.kind === "ambiguous" && q.field === "name"
    );
    expect(ambiguity?.candidates).toEqual(["Contact Name", "Lead Name"]);
    expect(mapping.assignments.has("name")).toBe(false);
    expect(mapping.assignments.get("email")).toBe(2);
  });

  it("asks on unmatched fields", () => {
    const mapping = mapColumns(["Name", "Email"]);
    const unmatched = mapping.questions.find((q) => q.kind === "unmatched");
    expect(unmatched?.field).toBeTruthy();
  });

  it("normalizes headers case/space-insensitively", () => {
    expect(normalizeHeader("  Phone _ Number ")).toBe("phonenumber");
  });
});

describe("formula-injection guard", () => {
  it("prefixes cells starting with =, +, -, or @", () => {
    expect(guardFormulaInjection("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(guardFormulaInjection("+123")).toBe("'+123");
    expect(guardFormulaInjection("-note")).toBe("'-note");
    expect(guardFormulaInjection("@cmd")).toBe("'@cmd");
    expect(guardFormulaInjection("normal value")).toBe("normal value");
    expect(guardFormulaInjection("555-0100")).toBe("555-0100"); // not leading
  });
});

describe("detectTextFormatColumns", () => {
  it("flags phone/postal/ID headers by name", () => {
    const columns = detectTextFormatColumns(
      ["Name", "Phone", "Postal Code", "Lead ID", "Email"],
      [[], [], [], [], []]
    );
    expect(columns).toEqual([1, 2, 3]);
  });

  it("flags columns whose values are long digit-only IDs", () => {
    const columns = detectTextFormatColumns(
      ["Account", "Reference"],
      [["a"], ["12345678901234", "99887766554321"]]
    );
    expect(columns).toEqual([1]);
  });
});

describe("buildTsvRows", () => {
  it("places fields at their mapped columns and guards formulas", () => {
    const mapping = new Map([["name", 1], ["email", 0]] as const);
    const tsv = buildTsvRows(
      [
        { name: "Ada Lovelace", email: "ada@example.com" },
        { name: "=evil()", email: "+12345" },
      ],
      mapping,
      3
    );
    const lines = tsv.split("\n");
    expect(lines[0]).toBe("ada@example.com\tAda Lovelace\t");
    expect(lines[1]).toBe("'+12345\t'=evil()\t");
  });
});

describe("verifyReadback", () => {
  const headers = ["Email", "Name", "Phone"];
  const mapping = new Map([
    ["email", 0],
    ["name", 1],
    ["phone", 2],
  ] as const);
  const leads = [
    { email: "ada@example.com", name: "Ada Lovelace", phone: "0123456789" },
    { email: "grace@example.com", name: "Grace Hopper", phone: "0987654321" },
  ];

  it("passes on exact matches and normalizes whitespace", () => {
    const result = verifyReadback(leads, mapping, headers, [
      ["ada@example.com", "Ada   Lovelace", "0123456789"],
      ["grace@example.com", "Grace Hopper", "0987654321"],
    ]);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reports every mismatch by row and column", () => {
    const result = verifyReadback(leads, mapping, headers, [
      ["ada@example.com", "Ada Lovelace", "123456789"], // phone lost leading zero
      ["grace@example.com", "Grace Hopper", "0987654322"], // wrong digit
    ]);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toHaveLength(2);
    expect(result.mismatches[0]).toMatchObject({
      rowIndex: 0,
      columnIndex: 2,
      header: "Phone",
      expected: "0123456789",
      actual: "123456789",
    });
    expect(result.mismatches[1].rowIndex).toBe(1);
  });

  it("accounts for the formula-injection prefix on both sides", () => {
    const guardedLeads = [{ email: "x@y.z", name: "=evil()", phone: "1" }];
    const result = verifyReadback(guardedLeads, mapping, headers, [
      ["x@y.z", "'=evil()", "1"],
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("ComputerUseClipboardService", () => {
  function makeClipboard(): ClipboardSeam & { text: string; writes: string[] } {
    const state = { text: "user's original clipboard", writes: [] as string[] };
    return {
      get text() {
        return state.text;
      },
      get writes() {
        return state.writes;
      },
      readText: () => state.text,
      writeText: (value) => {
        state.text = value;
        state.writes.push(value);
      },
    };
  }

  it("saves the user's text, writes the payload, and restores on success", () => {
    const clipboard = makeClipboard();
    const service = new ComputerUseClipboardService(clipboard);
    const saved = service.beginPaste("a\tb\nc\td");
    expect(clipboard.text).toBe("a\tb\nc\td");
    service.restoreAfterSuccess(saved);
    expect(clipboard.text).toBe("user's original clipboard");
    expect(service.pastePending).toBe(false);
  });

  it("restores on failure and on stop", () => {
    const clipboard = makeClipboard();
    const service = new ComputerUseClipboardService(clipboard);
    const saved = service.beginPaste("payload");
    service.restoreAfterFailure(saved);
    expect(clipboard.text).toBe("user's original clipboard");

    const second = service.beginPaste("payload2");
    expect(service.pastePending).toBe(true);
    service.restoreOnStop();
    expect(clipboard.text).toBe("user's original clipboard");
    expect(service.pastePending).toBe(false);
  });

  it("restore is idempotent", () => {
    const clipboard = makeClipboard();
    const service = new ComputerUseClipboardService(clipboard);
    const saved = service.beginPaste("payload");
    saved.restore();
    clipboard.writeText("intermediate");
    saved.restore();
    expect(clipboard.text).toBe("intermediate");
  });
});
