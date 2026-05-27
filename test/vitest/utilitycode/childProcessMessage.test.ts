"use strict";
import { describe, test, expect } from "vitest";
import {
  parseChildMessage,
  ParseChildMessageResult,
} from "@/utils/childProcessMessage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EmailSendResult {
  receiver: string;
  status: boolean;
  title: string;
  info: string;
  content: string;
}

interface EmailResult {
  url: string;
  pageTitle: string;
  emails: string[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseChildMessage", () => {
  // ── Format 1: raw JSON string ─────────────────────────────────────────

  describe("format 1 — raw JSON string", () => {
    test("parses action-only message from string", () => {
      const message = JSON.stringify({ action: "sendEmailEnd" });
      const result = parseChildMessage<null>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("sendEmailEnd");
        expect(result.data.data).toBeUndefined();
      }
    });

    test("parses action with data from string", () => {
      const payload = {
        action: "EmailSendSuccess",
        data: {
          receiver: "test@example.com",
          status: true,
          title: "Hello",
          content: "World",
          info: "",
        },
      };
      const message = JSON.stringify(payload);
      const result = parseChildMessage<EmailSendResult>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("EmailSendSuccess");
        expect(result.data.data?.receiver).toBe("test@example.com");
        expect(result.data.data?.status).toBe(true);
      }
    });

    test("returns error for invalid JSON string", () => {
      const result = parseChildMessage<null>("not-json{{{");

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.reason).toContain("Failed to parse string");
      }
    });

    test("returns error for valid JSON without action", () => {
      const result = parseChildMessage<null>(JSON.stringify({ foo: "bar" }));

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.reason).toContain("valid action");
      }
    });
  });

  // ── Format 2: wrapped { data: "json-string" } ─────────────────────────

  describe("format 2 — wrapped { data: string }", () => {
    test("parses action-only wrapped message", () => {
      const message = {
        data: JSON.stringify({ action: "sendEmailEnd" }),
      };
      const result = parseChildMessage<null>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("sendEmailEnd");
      }
    });

    test("parses wrapped message with data payload", () => {
      const inner = {
        action: "saveres",
        data: {
          url: "https://example.com",
          pageTitle: "Example",
          emails: ["a@b.com", "c@d.com"],
          filteredLinks: [],
        },
      };
      const message = { data: JSON.stringify(inner) };
      const result = parseChildMessage<EmailResult>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("saveres");
        expect(result.data.data?.emails).toEqual(["a@b.com", "c@d.com"]);
      }
    });

    test("returns error when wrapped data is not valid JSON", () => {
      const message = { data: "not-json{{{" };
      const result = parseChildMessage<null>(message);

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.reason).toContain("Failed to parse wrapped");
      }
    });

    test("returns error when wrapped data JSON has no action", () => {
      const message = { data: JSON.stringify({ status: "ok" }) };
      const result = parseChildMessage<null>(message);

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.reason).toContain("valid action");
      }
    });
  });

  // ── Format 3: direct object with action property ──────────────────────

  describe("format 3 — direct object { action, data }", () => {
    test("parses direct action-only message (the bug scenario)", () => {
      // This is the exact format that was causing the error:
      // "Invalid message from child process: {"action":"sendEmailEnd"}"
      const message = { action: "sendEmailEnd" };
      const result = parseChildMessage<null>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("sendEmailEnd");
        expect(result.data.data).toBeUndefined();
      }
    });

    test("parses direct message with data payload", () => {
      const message = {
        action: "EmailSendFailure",
        data: {
          receiver: "fail@example.com",
          status: false,
          title: "Subject",
          content: "Body",
          info: "Connection refused",
        },
      };
      const result = parseChildMessage<EmailSendResult>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("EmailSendFailure");
        expect(result.data.data?.receiver).toBe("fail@example.com");
        expect(result.data.data?.info).toBe("Connection refused");
      }
    });

    test("parses saveres message with nested data", () => {
      const message = {
        action: "saveres",
        data: {
          url: "https://test.com/page",
          pageTitle: "Test Page",
          emails: ["x@y.com"],
          filteredLinks: ["https://test.com/link"],
        },
      };
      const result = parseChildMessage<EmailResult>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("saveres");
        expect(result.data.data?.url).toBe("https://test.com/page");
        expect(result.data.data?.emails).toEqual(["x@y.com"]);
      }
    });
  });

  // ── Error / edge cases ────────────────────────────────────────────────

  describe("error and edge cases", () => {
    test("returns error for null", () => {
      const result = parseChildMessage<null>(null);

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.reason).toContain("not a string or object");
      }
    });

    test("returns error for undefined", () => {
      const result = parseChildMessage<null>(undefined);

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.reason).toContain("not a string or object");
      }
    });

    test("returns error for number", () => {
      const result = parseChildMessage<null>(42);

      expect(result.kind).toBe("error");
    });

    test("returns error for boolean", () => {
      const result = parseChildMessage<null>(true);

      expect(result.kind).toBe("error");
    });

    test("returns error for empty object", () => {
      const result = parseChildMessage<null>({});

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.reason).toContain("neither 'action' nor 'data'");
      }
    });

    test("returns error for object with action as number", () => {
      const result = parseChildMessage<null>({ action: 123 });

      expect(result.kind).toBe("error");
    });

    test("returns error for object with data as number (not string)", () => {
      const result = parseChildMessage<null>({ data: 123 });

      expect(result.kind).toBe("error");
    });

    test("prefers action over data when both present", () => {
      // When both 'action' and 'data' are top-level, the direct format
      // (format 3) takes precedence — this matches the module behavior.
      const message = {
        action: "sendEmailEnd",
        data: JSON.stringify({ action: "different" }),
      };
      const result = parseChildMessage<null>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("sendEmailEnd");
      }
    });

    test("handles complex nested data payload", () => {
      const message = {
        action: "savesearchresult",
        data: [
          { title: "Item 1", url: "https://a.com" },
          { title: "Item 2", url: "https://b.com" },
        ],
      };
      type SearchResult = { title: string; url: string }[];
      const result = parseChildMessage<SearchResult>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("savesearchresult");
        expect(result.data.data).toHaveLength(2);
        expect(result.data.data?.[0].title).toBe("Item 1");
      }
    });

    test("handles action with null data", () => {
      const message = { action: "someAction", data: null };
      const result = parseChildMessage<null>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("someAction");
        expect(result.data.data).toBeNull();
      }
    });

    test("handles action with empty string data", () => {
      const message = { action: "sendEmailEnd", data: "" };
      const result = parseChildMessage<string>(message);

      expect(result.kind).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.data.action).toBe("sendEmailEnd");
        expect(result.data.data).toBe("");
      }
    });
  });
});
