"use strict";
import AdmZip from "adm-zip";
import { describe, expect, test } from "vitest";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import { SkillImportService } from "@/service/SkillImportService";

describe("SkillImportService - Manifest Validation", () => {
  const validJsManifest = {
    name: "my-skill",
    version: "1.0.0",
    description: "A test skill",
    runtime: "javascript" as const,
    entry: "index.js",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
    },
  };

  const validPythonManifest: SkillManifest = {
    name: "py-skill",
    version: "1.0.0",
    description: "Py skill",
    runtime: "python",
    entry: "run.py",
    parameters: {
      type: "object",
      properties: {
        attachment_ref: { type: "string" },
      },
    },
    python: {
      version: ">=3.10",
      requirements_file: "requirements.txt",
    },
  };

  describe("valid manifests", () => {
    test("should accept a valid javascript manifest", () => {
      const result = SkillImportService.validateManifest(validJsManifest);
      expect(result.valid).toBe(true);
    });

    test("should accept manifest with optional fields", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        author: "Test Author",
        permissions: ["network"],
      });
      expect(result.valid).toBe(true);
    });

    test("should accept prerelease semver", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        version: "1.0.0-beta.1",
      });
      expect(result.valid).toBe(true);
    });

    test("should accept valid python manifest", () => {
      const result = SkillImportService.validateManifest(validPythonManifest);
      expect(result.valid).toBe(true);
    });

    test("should accept javascript manifest with python_attachment_execution", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        documentationOnly: true,
        entry: "__skill_md_wrapper__.js",
        python_attachment_execution: {
          version: ">=3.10",
          requirements_file: "requirements.txt",
          entry: "run_pdf.py",
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("invalid manifests", () => {
    test("should reject null input", () => {
      const result = SkillImportService.validateManifest(null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("must be a JSON object");
      }
    });

    test("should reject missing name", () => {
      const { name: _n, ...withoutName } = validJsManifest;
      const result = SkillImportService.validateManifest(withoutName);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("name");
      }
    });

    test("should reject invalid name format", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        name: "InvalidName",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Invalid skill name");
      }
    });

    test("should reject invalid version", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        version: "1.0",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("semver");
      }
    });

    test("should reject unsupported runtime", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        runtime: "ruby",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Unsupported runtime");
      }
    });

    test("should reject python without python block", () => {
      const result = SkillImportService.validateManifest({
        ...validPythonManifest,
        python: undefined,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('"python" object');
      }
    });

    test("should reject python with non-py entry", () => {
      const result = SkillImportService.validateManifest({
        ...validPythonManifest,
        entry: "run.js",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain(".py");
      }
    });

    test("should reject python documentationOnly", () => {
      const result = SkillImportService.validateManifest({
        ...validPythonManifest,
        documentationOnly: true,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("documentationOnly");
      }
    });

    test("should reject missing parameters", () => {
      const { parameters: _p, ...withoutParams } = validJsManifest;
      const result = SkillImportService.validateManifest(withoutParams);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("parameters");
      }
    });

    test("should reject parameters without type: object", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        parameters: { type: "string" },
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('type": "object"');
      }
    });

    test("should reject invalid permission value", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        permissions: ["invalid_permission"],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Invalid permission");
      }
    });

    test("should reject too-long description", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        description: "x".repeat(501),
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("500 characters");
      }
    });

    test("should reject python runtime with python_attachment_execution", () => {
      const result = SkillImportService.validateManifest({
        ...validPythonManifest,
        python_attachment_execution: {
          version: ">=3.10",
          requirements_file: "requirements.txt",
          entry: "side.py",
        },
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("python_attachment_execution");
      }
    });

    test("should reject python_attachment_execution without .py entry", () => {
      const result = SkillImportService.validateManifest({
        ...validJsManifest,
        python_attachment_execution: {
          version: ">=3.10",
          requirements_file: "requirements.txt",
          entry: "side.js",
        },
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain(".py");
      }
    });
  });

  describe("validatePythonSkillZip", () => {
    test("returns null for javascript manifest", () => {
      const zip = new AdmZip();
      expect(
        SkillImportService.validatePythonSkillZip(zip, validJsManifest)
      ).toBeNull();
    });

    test("rejects zip that ships .env", () => {
      const zip = new AdmZip();
      zip.addFile(".env/pyvenv.cfg", Buffer.from("home=foo", "utf-8"));
      const err = SkillImportService.validatePythonSkillZip(
        zip,
        validPythonManifest
      );
      expect(err).toContain(".env");
    });

    test("rejects requirements without hashes", () => {
      const zip = new AdmZip();
      zip.addFile(
        "requirements.txt",
        Buffer.from("pdf2image==1.17.0\n", "utf-8")
      );
      const err = SkillImportService.validatePythonSkillZip(
        zip,
        validPythonManifest
      );
      expect(err).toContain("hash");
    });

    test("accepts hash-pinned requirements in zip", () => {
      const zip = new AdmZip();
      zip.addFile(
        "requirements.txt",
        Buffer.from(
          "pdf2image==1.17.0 --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
          "utf-8"
        )
      );
      expect(
        SkillImportService.validatePythonSkillZip(zip, validPythonManifest)
      ).toBeNull();
    });

    test("validates python_attachment_execution for javascript manifest", () => {
      const zip = new AdmZip();
      zip.addFile(
        "requirements.txt",
        Buffer.from(
          "pdf2image==1.17.0 --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
          "utf-8"
        )
      );
      zip.addFile("run_pdf.py", Buffer.from("# stub", "utf-8"));
      const manifest: SkillManifest = {
        ...validJsManifest,
        documentationOnly: true,
        python_attachment_execution: {
          version: ">=3.10",
          requirements_file: "requirements.txt",
          entry: "run_pdf.py",
        },
      };
      expect(SkillImportService.validatePythonSkillZip(zip, manifest)).toBeNull();
    });

    test("rejects javascript manifest with python_attachment_execution missing py file in zip", () => {
      const zip = new AdmZip();
      zip.addFile(
        "requirements.txt",
        Buffer.from(
          "pdf2image==1.17.0 --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
          "utf-8"
        )
      );
      const manifest: SkillManifest = {
        ...validJsManifest,
        documentationOnly: true,
        python_attachment_execution: {
          version: ">=3.10",
          requirements_file: "requirements.txt",
          entry: "missing.py",
        },
      };
      const err = SkillImportService.validatePythonSkillZip(zip, manifest);
      expect(err).toContain("not found");
    });
  });
});
