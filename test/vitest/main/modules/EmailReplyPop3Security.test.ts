import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  sanitizeHeaderValue,
  POP3_MAX_RESPONSE_BYTES,
} from "@/service/emailReceive/Pop3EmailReceiveClient";

/**
 * D8 (review) — three security advisories in the POP3 receive client:
 *
 *  1. POP3 TLS — `tls.connect` hardcoded `rejectUnauthorized: false`,
 *     disabling certificate validation for every SSL connection (MITM risk).
 *     Now defaults to ON (cert validation enforced); only disabled on
 *     explicit opt-out via `tlsRejectUnauthorized: false`.
 *  2. Unbounded error — `sendMultiLineCommand` accumulated the response
 *     buffer without bound; a malicious/buggy server streaming without the
 *     `.` terminator caused unbounded memory growth. Now capped at
 *     {@link POP3_MAX_RESPONSE_BYTES}; exceeding the cap rejects the response.
 *  3. Subject control chars — `parsed.subject.slice(0, 998)` kept NUL/CR/LF
 *     and other C0 control chars that break log lines and downstream
 *     storage. Now routed through {@link sanitizeHeaderValue}.
 *
 * Behavioral coverage of the pure `sanitizeHeaderValue` plus source-contract
 * guards for the socket-level fixes (raw-socket POP3 is not unit-testable
 * without a fake socket server; the contract guards fail at test time if the
 * fixes are reverted).
 */
const POP3_SRC = path.resolve(
  __dirname,
  "../../../../src/service/emailReceive/Pop3EmailReceiveClient.ts"
);

function readSrc(): string {
  return fs.readFileSync(POP3_SRC, "utf8");
}

describe("D8 — POP3 security fixes", () => {
  // ----- D8.3: subject control-char sanitization (behavioral) -----

  describe("sanitizeHeaderValue (D8.3)", () => {
    it("passes through a clean subject", () => {
      expect(sanitizeHeaderValue("Re: Pricing?")).toBe("Re: Pricing?");
    });

    it("collapses embedded CR/LF runs to a single space (log-injection guard)", () => {
      // A subject with embedded newlines can break log lines and inject
      // fake log entries. Each CR/LF run collapses to one space.
      expect(
        sanitizeHeaderValue("Re: Pricing\r\nINJECTED: fake log line\r\n")
      ).toBe("Re: Pricing INJECTED: fake log line ");
    });

    it("strips NUL and other C0 control chars except tab", () => {
      // NUL (0x00), BEL (0x07), BS (0x08), VT (0x0B), ESC (0x1B), DEL (0x7F)
      // are stripped. Tab (0x09) is preserved (legitimate whitespace).
      const input = "Re:\tPricing\x00\x07\x08\x0B\x1B\x7F?";
      expect(sanitizeHeaderValue(input)).toBe("Re:\tPricing?");
    });

    it("preserves the 998-char subject cap", () => {
      const long = "A".repeat(2000);
      expect(sanitizeHeaderValue(long)).toHaveLength(998);
    });

    it("treats a nullish subject as (no subject)", () => {
      // The caller passes "(no subject)" when parsed.subject is nullish;
      // sanitizeHeaderValue only normalizes whatever string it receives.
      expect(sanitizeHeaderValue("(no subject)")).toBe("(no subject)");
    });
  });

  // ----- D8.1: POP3 TLS cert validation (source contract) -----

  describe("TLS certificate validation (D8.1)", () => {
    it("tls.connect honors tlsRejectUnauthorized (no hardcoded false)", () => {
      const src = readSrc();
      // The hardcoded `rejectUnauthorized: false` is gone — replaced by
      // the configurable field.
      expect(src).not.toMatch(/rejectUnauthorized:\s*false/);
      // The connect options now read the field.
      expect(src).toMatch(/rejectUnauthorized:\s*this\.tlsRejectUnauthorized/);
    });

    it("callers default to true (cert validation ON) when the flag is unset", () => {
      const src = readSrc();
      // Both call sites (testConnection + fetchMessages) pass
      // `config.tlsRejectUnauthorized ?? true`.
      expect(src).toMatch(/config\.tlsRejectUnauthorized\s*\?\?\s*true/g);
    });

    it("the connection config type exposes the tlsRejectUnauthorized field", () => {
      const typesSrc = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../src/entityTypes/emailReceiveTypes.ts"
        ),
        "utf8"
      );
      expect(typesSrc).toMatch(/readonly tlsRejectUnauthorized\??:\s*boolean/);
    });
  });

  // ----- D8.2: unbounded response buffer (source contract + constant) -----

  describe("unbounded response buffer cap (D8.2)", () => {
    it("exports a POP3_MAX_RESPONSE_BYTES cap", () => {
      expect(POP3_MAX_RESPONSE_BYTES).toBe(50 * 1024 * 1024);
      // Sane magnitude — well above any legitimate email, well below
      // memory-exhaustion territory.
      expect(POP3_MAX_RESPONSE_BYTES).toBeGreaterThan(10 * 1024 * 1024);
      expect(POP3_MAX_RESPONSE_BYTES).toBeLessThan(100 * 1024 * 1024);
    });

    it("sendMultiLineCommand rejects when the buffer exceeds the cap", () => {
      const src = readSrc();
      // The buffer-check path must consult the cap and reject.
      expect(src).toMatch(/POP3_MAX_RESPONSE_BYTES/);
      expect(src).toMatch(/exceeded.*bytes without terminator|response exceeded.*POP3_MAX_RESPONSE_BYTES/);
    });
  });

  // ----- D8.3 cross-client: IMAP subject sanitization (same bug class) -----

  describe("IMAP subject sanitization (D8.3 cross-client)", () => {
    // Cycle-2 re-review found the POP3 fix missed the identical vulnerable
    // line in the IMAP client (the default receive path). The helper now
    // lives in EmailMessageParser and both clients import + use it.
    const IMAP_SRC = path.resolve(
      __dirname,
      "../../../../src/service/emailReceive/ImapEmailReceiveClient.ts"
    );
    const PARSER_SRC = path.resolve(
      __dirname,
      "../../../../src/service/emailReceive/EmailMessageParser.ts"
    );

    it("the helper lives in the shared EmailMessageParser (not the POP3 client)", () => {
      const parser = fs.readFileSync(PARSER_SRC, "utf8");
      expect(parser).toMatch(/export function sanitizeHeaderValue/);
    });

    it("IMAP client imports + uses sanitizeHeaderValue at the subject site", () => {
      const imap = fs.readFileSync(IMAP_SRC, "utf8");
      expect(imap).toMatch(/sanitizeHeaderValue/);
      expect(imap).toMatch(
        /from "@\/service\/emailReceive\/EmailMessageParser"/
      );
      // The vulnerable bare `.slice(0, 998)` on the subject is gone.
      expect(imap).not.toMatch(/subject.*\.slice\(0,\s*998\)/);
    });

    it("POP3 client imports the helper from the shared parser (no local definition)", () => {
      const pop3 = readSrc();
      expect(pop3).toMatch(
        /from "@\/service\/emailReceive\/EmailMessageParser"/
      );
      // No local function definition remains in the POP3 client — the helper
      // was moved to the shared parser.
      expect(pop3).not.toMatch(/export function sanitizeHeaderValue/);
    });
  });
});
