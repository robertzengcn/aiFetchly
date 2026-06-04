"use strict";
import { describe, expect, test } from "vitest";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import { PythonSkillRuntimeService } from "@/service/PythonSkillRuntimeService";

describe("PythonSkillRuntimeService", () => {
  test("executePythonSkill rejects javascript manifest", async () => {
    const manifest: SkillManifest = {
      name: "x",
      version: "1.0.0",
      description: "d",
      runtime: "javascript",
      entry: "index.js",
      parameters: { type: "object", properties: {} },
    };
    const result = await PythonSkillRuntimeService.executePythonSkill({
      manifest,
      skillDir: "/tmp",
      args: {},
      context: { conversationId: "c1", toolCallId: "tc1" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.result.mode).toBe("python_skill_runtime_error");
    }
  });

  test("executePythonSkill rejects python manifest without python block", async () => {
    const manifest: SkillManifest = {
      name: "broken-skill",
      version: "1.0.0",
      description: "d",
      runtime: "python",
      entry: "run.py",
      parameters: { type: "object", properties: {} },
    };
    const result = await PythonSkillRuntimeService.executePythonSkill({
      manifest,
      skillDir: "/tmp",
      args: {},
      context: { conversationId: "c1", toolCallId: "tc1" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.result.mode).toBe("python_skill_runtime_error");
      expect(result.result.error as string).toContain("python manifest block");
    }
  });

  test("executePythonSkill rejects when required arg is missing", async () => {
    const manifest: SkillManifest = {
      name: "py-skill",
      version: "1.0.0",
      description: "d",
      runtime: "python",
      entry: "run.py",
      parameters: {
        type: "object",
        properties: {
          attachment_ref: { type: "string" },
        },
        required: ["attachment_ref"],
      },
      python: {
        version: ">=3.10",
        requirements_file: "requirements.txt",
      },
    };
    const result = await PythonSkillRuntimeService.executePythonSkill({
      manifest,
      skillDir: "/tmp",
      args: {},
      context: { conversationId: "c1", toolCallId: "tc1" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.result.mode).toBe("python_skill_runtime_error");
      expect(result.result.error as string).toContain(
        "Missing required argument"
      );
    }
  });

  test("executePythonSkill handles attachment_ref without conversationId", async () => {
    const manifest: SkillManifest = {
      name: "py-skill",
      version: "1.0.0",
      description: "d",
      runtime: "python",
      entry: "run.py",
      parameters: { type: "object", properties: {} },
      python: {
        version: ">=3.10",
        requirements_file: "requirements.txt",
      },
    };
    // When attachment_ref is set but conversationId is empty, the function
    // will fail at some point (script validation or attachment processing)
    const result = await PythonSkillRuntimeService.executePythonSkill({
      manifest,
      skillDir: "/tmp",
      args: { attachment_ref: "file.pdf" },
      context: { conversationId: "", toolCallId: "tc1" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.result.mode).toBe("python_skill_runtime_error");
    }
  });
});
