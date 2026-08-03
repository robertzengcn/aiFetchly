/**
 * CFG-07 — Restricted frontmatter parser tests.
 *
 * Security contract under test: parseRestrictedFrontmatter MUST NEVER execute
 * YAML tags. It supports only scalars (`key: value`) and string arrays
 * (`key:\n  - item`), fails closed on anything else, and preserves the body
 * byte-for-byte (modulo CRLF/CR -> LF normalization, which is documented).
 *
 * The parser is hand-rolled on purpose. Do NOT reintroduce any YAML library
 * dependency anywhere under src/service/aifetchlyConfig/ — the default schema
 * of common YAML libraries executes untrusted tags, which is unsafe for
 * workspace-scanned files.
 */
import { describe, expect, it } from "vitest";
import {
  parseRestrictedFrontmatter,
  type ParsedFrontmatter,
} from "@/service/aifetchlyConfig/AIFetchlyConfigMarkdown";

describe("parseRestrictedFrontmatter (CFG-07)", () => {
  describe("happy path", () => {
    it("parses scalar fields and returns the body", () => {
      const text = "---\nname: review\ndescription: x\n---\nbody";
      const r = parseRestrictedFrontmatter(text);
      expect(r).not.toBeNull();
      expect(r!.scalars.get("name")).toBe("review");
      expect(r!.scalars.get("description")).toBe("x");
      expect(r!.body).toBe("body");
    });

    it("parses a string array field", () => {
      const text = "---\nname: review\naliases:\n  - rv\n  - r\n---\nbody";
      const r = parseRestrictedFrontmatter(text);
      expect(r).not.toBeNull();
      expect(r!.arrays.get("aliases")).toEqual(["rv", "r"]);
    });

    it("mixes scalars and arrays in the same block", () => {
      const text =
        "---\nname: review\naliases:\n  - rv\ndescription: d\n---\nbody";
      const r = parseRestrictedFrontmatter(text);
      expect(r).not.toBeNull();
      expect(r!.scalars.get("name")).toBe("review");
      expect(r!.scalars.get("description")).toBe("d");
      expect(r!.arrays.get("aliases")).toEqual(["rv"]);
    });

    it("preserves the body byte-for-byte including leading/trailing whitespace", () => {
      const opener = "---\nname: x\n---\n";
      const body = "  leading\n\nblank line\ntrailing  \n";
      const r = parseRestrictedFrontmatter(opener + body);
      expect(r!.body).toBe(body);
    });

    it("returns an empty body when the frontmatter is the whole input", () => {
      const r = parseRestrictedFrontmatter("---\nname: x\n---\n");
      expect(r!.body).toBe("");
    });

    it("preserves a body that itself contains a '---' line", () => {
      const text = "---\nname: x\n---\nbody line 1\n---\nbody line 2";
      const r = parseRestrictedFrontmatter(text);
      expect(r!.body).toBe("body line 1\n---\nbody line 2");
    });
  });

  describe("fail closed (CFG-07 security invariants)", () => {
    it.each([
      ["plain text without opener", "just some text"],
      ["empty string", ""],
      ["opener missing trailing newline", "---"],
      ["opener with leading space", " ---\nname: x\n---\nbody"],
      ["opener with trailing space", "--- \nname: x\n---\nbody"],
    ])("returns null for %s", (_label, input) => {
      expect(parseRestrictedFrontmatter(input)).toBeNull();
    });

    it("returns null when the opener is never terminated (unterminated block)", () => {
      expect(parseRestrictedFrontmatter("---\nname: x\nno closer here")).toBeNull();
    });

    it("rejects a !!js/function YAML tag by returning null (never executes)", () => {
      const malicious =
        "---\nname: x\ntag: !!js/function 'require(\"child_process\").execSync(\"id\")'\n---\nbody";
      expect(parseRestrictedFrontmatter(malicious)).toBeNull();
    });

    it("rejects a !ref-style YAML tag by returning null", () => {
      const malicious = "---\nname: x\nvalue: !ref 'something'\n---\nbody";
      expect(parseRestrictedFrontmatter(malicious)).toBeNull();
    });

    it("rejects a standalone tag directive line by returning null", () => {
      const malicious = "---\n!!js/function 'evil'\n---\nbody";
      expect(parseRestrictedFrontmatter(malicious)).toBeNull();
    });

    it("rejects a nested map (indented key: value) by returning null", () => {
      const text = "---\nname: x\n  nested: bad\n---\nbody";
      expect(parseRestrictedFrontmatter(text)).toBeNull();
    });

    it("rejects a stray list item outside an array context by returning null", () => {
      const text = "---\n  - stray\n---\nbody";
      expect(parseRestrictedFrontmatter(text)).toBeNull();
    });

    it("rejects a header line without a colon by returning null", () => {
      const text = "---\njusttext\n---\nbody";
      expect(parseRestrictedFrontmatter(text)).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("parses an empty frontmatter block (opener immediately followed by closer)", () => {
      const r = parseRestrictedFrontmatter("---\n---\nbody");
      expect(r).not.toBeNull();
      expect(r!.scalars.size).toBe(0);
      expect(r!.arrays.size).toBe(0);
      expect(r!.body).toBe("body");
    });

    it("parses a scalar with an empty value", () => {
      const r = parseRestrictedFrontmatter("---\nname:\n---\nbody");
      expect(r).not.toBeNull();
      expect(r!.scalars.get("name")).toBe("");
    });

    it("treats 'key:' with no following array items as an empty-value scalar (no empty arrays)", () => {
      // The restricted grammar has no explicit empty-array marker; a key with
      // colon but no indented '- item' lines is a scalar with value "".
      const r = parseRestrictedFrontmatter("---\naliases:\n---\nbody");
      expect(r).not.toBeNull();
      expect(r!.scalars.get("aliases")).toBe("");
      expect(r!.arrays.has("aliases")).toBe(false);
    });

    it("normalizes CRLF line endings to LF", () => {
      const text = "---\r\nname: review\r\n---\r\nbody";
      const r = parseRestrictedFrontmatter(text);
      expect(r).not.toBeNull();
      expect(r!.scalars.get("name")).toBe("review");
      // After CRLF normalization, the body uses LF endings.
      expect(r!.body).toBe("body");
    });

    it("trims surrounding whitespace from scalar values", () => {
      const r = parseRestrictedFrontmatter("---\nname:   review   \n---\nbody");
      expect(r!.scalars.get("name")).toBe("review");
    });

    it("trims surrounding whitespace from array item values", () => {
      const r = parseRestrictedFrontmatter(
        "---\naliases:\n  -   rv  \n---\nbody"
      );
      expect(r!.arrays.get("aliases")).toEqual(["rv"]);
    });

    it("accepts a scalar value that contains '!!' outside the start (no false positive)", () => {
      const r = parseRestrictedFrontmatter(
        "---\ndescription: Warning!!\n---\nbody"
      );
      expect(r!.scalars.get("description")).toBe("Warning!!");
    });

    it("preserves a body that ends with a trailing newline", () => {
      const r = parseRestrictedFrontmatter("---\nname: x\n---\nbody\n");
      expect(r!.body).toBe("body\n");
    });

    it("parses a closer at EOF with no trailing newline", () => {
      const r = parseRestrictedFrontmatter("---\nname: x\n---");
      expect(r).not.toBeNull();
      expect(r!.scalars.get("name")).toBe("x");
      expect(r!.body).toBe("");
    });
  });

  describe("ParsedFrontmatter shape", () => {
    it("returns ReadonlyMap instances for scalars and arrays", () => {
      const r = parseRestrictedFrontmatter(
        "---\nname: x\naliases:\n  - a\n---\nbody"
      )!;
      expect(r.scalars).toBeInstanceOf(Map);
      expect(r.arrays).toBeInstanceOf(Map);
      // sanity: the returned object is a ParsedFrontmatter
      const _typeCheck: ParsedFrontmatter = r;
      expect(_typeCheck.body).toBe("body");
    });
  });
});
