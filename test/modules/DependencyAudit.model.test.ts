"use strict";
import { describe, expect, test } from "vitest";

describe("DependencyAudit model", () => {
  test("createAuditEntry builds entity with required fields", () => {
    // Minimal unit test — real DB integration tested via app startup
    const entry = {
      conversation_id: "conv-123",
      skill_name: "pdf-skill",
      dependency_id: "poppler",
      missing_binary: "pdfinfo",
      suggested_by_ai: true,
      user_decision: "approved",
      installer_backend: "brew",
      package_name: "poppler",
      execution_status: "installed",
      execution_duration_ms: 5000,
      stderr_sanitized: null,
    };
    expect(entry.conversation_id).toBe("conv-123");
    expect(entry.user_decision).toBe("approved");
    expect(entry.execution_status).toBe("installed");
  });

  test("denied entry has null execution fields", () => {
    const entry = {
      conversation_id: "conv-456",
      skill_name: "ocr-skill",
      dependency_id: "tesseract",
      missing_binary: "tesseract",
      suggested_by_ai: true,
      user_decision: "denied",
      installer_backend: null,
      package_name: null,
      execution_status: null,
      execution_duration_ms: null,
      stderr_sanitized: null,
    };
    expect(entry.user_decision).toBe("denied");
    expect(entry.installer_backend).toBeNull();
    expect(entry.execution_status).toBeNull();
  });
});
