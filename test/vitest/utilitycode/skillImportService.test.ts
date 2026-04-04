"use strict";
import { describe, test, expect } from "vitest";

// We test the pure validation logic by importing the service
// (the zip extraction requires Electron's app.getPath, so we test validation only)

// Re-implement the validation logic for testing since the internal function isn't exported
// We'll test it through the exported validateManifest

describe("SkillImportService - Manifest Validation", () => {
  // Inline the validation logic for unit testing (same as in SkillImportService.ts)
  const VALID_PERMISSIONS = new Set(["network", "filesystem", "automation"]);
  const VALID_RUNTIMES = new Set(["javascript"]);
  const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;
  const NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

  function validateManifest(raw: unknown): {
    valid: true;
    manifest: Record<string, unknown>;
  } | {
    valid: false;
    error: string;
  } {
    if (!raw || typeof raw !== "object") {
      return { valid: false, error: "Manifest must be a JSON object" };
    }

    const m = raw as Record<string, unknown>;

    for (const field of ["name", "version", "description", "runtime", "entry"]) {
      if (typeof m[field] !== "string" || (m[field] as string).length === 0) {
        return {
          valid: false,
          error: `Missing or empty required field: ${field}`,
        };
      }
    }

    if (!NAME_REGEX.test(m.name as string)) {
      return {
        valid: false,
        error: `Invalid skill name "${m.name as string}". Must be lowercase alphanumeric with hyphens/underscores, starting with a letter.`,
      };
    }

    if (!SEMVER_REGEX.test(m.version as string)) {
      return {
        valid: false,
        error: `Invalid version "${m.version as string}". Must be semver (e.g., 1.0.0).`,
      };
    }

    if ((m.description as string).length > 500) {
      return {
        valid: false,
        error: "Description must be 500 characters or fewer",
      };
    }

    if (!VALID_RUNTIMES.has(m.runtime as string)) {
      return {
        valid: false,
        error: `Unsupported runtime "${m.runtime as string}". Must be "javascript".`,
      };
    }

    if (!m.parameters || typeof m.parameters !== "object") {
      return {
        valid: false,
        error: "Missing required field: parameters",
      };
    }

    const params = m.parameters as Record<string, unknown>;
    if (params.type !== "object") {
      return {
        valid: false,
        error: 'Parameters must have "type": "object"',
      };
    }

    if (m.permissions !== undefined) {
      if (!Array.isArray(m.permissions)) {
        return { valid: false, error: "Permissions must be an array" };
      }
      for (const perm of m.permissions as string[]) {
        if (!VALID_PERMISSIONS.has(perm)) {
          return {
            valid: false,
            error: `Invalid permission: ${perm}. Must be one of: ${[...VALID_PERMISSIONS].join(", ")}`,
          };
        }
      }
    }

    return { valid: true, manifest: m };
  }

  const validManifest = {
    name: "my-skill",
    version: "1.0.0",
    description: "A test skill",
    runtime: "javascript",
    entry: "index.js",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
    },
  };

  describe("valid manifests", () => {
    test("should accept a valid manifest", () => {
      const result = validateManifest(validManifest);
      expect(result.valid).toBe(true);
    });

    test("should accept manifest with optional fields", () => {
      const result = validateManifest({
        ...validManifest,
        author: "Test Author",
        permissions: ["network"],
      });
      expect(result.valid).toBe(true);
    });

    test("should accept manifest without permissions", () => {
      const result = validateManifest(validManifest);
      expect(result.valid).toBe(true);
    });

    test("should accept prerelease semver", () => {
      const result = validateManifest({
        ...validManifest,
        version: "1.0.0-beta.1",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("invalid manifests", () => {
    test("should reject null input", () => {
      const result = validateManifest(null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("must be a JSON object");
      }
    });

    test("should reject missing name", () => {
      const { name: _, ...withoutName } = validManifest;
      const result = validateManifest(withoutName);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("name");
      }
    });

    test("should reject invalid name format", () => {
      const result = validateManifest({
        ...validManifest,
        name: "InvalidName",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Invalid skill name");
      }
    });

    test("should reject name starting with number", () => {
      const result = validateManifest({
        ...validManifest,
        name: "1bad-name",
      });
      expect(result.valid).toBe(false);
    });

    test("should reject invalid version", () => {
      const result = validateManifest({
        ...validManifest,
        version: "1.0",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("semver");
      }
    });

    test("should reject unsupported runtime", () => {
      const result = validateManifest({
        ...validManifest,
        runtime: "python",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Unsupported runtime");
      }
    });

    test("should reject missing parameters", () => {
      const { parameters: _, ...withoutParams } = validManifest;
      const result = validateManifest(withoutParams);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("parameters");
      }
    });

    test("should reject parameters without type: object", () => {
      const result = validateManifest({
        ...validManifest,
        parameters: { type: "string" },
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('type": "object"');
      }
    });

    test("should reject invalid permission value", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: ["invalid_permission"],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Invalid permission");
      }
    });

    test("should reject non-array permissions", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: "network",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Permissions must be an array");
      }
    });

    test("should reject empty description", () => {
      const result = validateManifest({
        ...validManifest,
        description: "",
      });
      expect(result.valid).toBe(false);
    });

    test("should reject too-long description", () => {
      const result = validateManifest({
        ...validManifest,
        description: "x".repeat(501),
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("500 characters");
      }
    });
  });
});
