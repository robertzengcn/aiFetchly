import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * System Dependency IPC 入参 schema。
 *
 * 注意：RESOLVE 的 ResolveSystemDependencyInput 包含 manifest 和 platform
 * 两个非序列化友好字段。manifest 是复杂 SkillManifest 结构，platform 是
 * NodeJS.Platform 字面量联合。本 schema 只校验 stderr（必填字符串）和
 * 元信息 conversation_id/skill_name（原 handler 解构出来传给 module
 * 的 options）。manifest/platform 通过 schema 的 .passthrough() 思路保留，
 * 这里用 z.passthrough() 的等价：用 z.object 而非 z.strictObject。
 */

export const resolveSystemDependencyInputSchema = lazySchema(() =>
  z
    .object({
      stderr: z.string().min(1, "stderr is required"),
      conversation_id: z.string().optional(),
      skill_name: z.string().optional(),
      // manifest/platform 字段类型复杂、且原 handler 也只是 destructure 后
      // 通过 ...resolveInput 透传给 module —— schema 不强校验，允许透传。
    })
    .passthrough()
);

export const installSystemDependencyInputSchema = lazySchema(() =>
  z.strictObject({
    dependency_id: z.string().min(1),
    // reason is required by InstallSystemDependencyRequest type. Original
    // handler didn't validate it (only checked the 3 IDs), so this is a
    // slight tightening: callers now must send reason. Frontend already
    // passes it (from resolver output context), so this is safe.
    reason: z.string(),
    conversation_id: z.string().min(1),
    skill_name: z.string().min(1),
  })
);

export const getAuditLogInputSchema = lazySchema(() =>
  z.strictObject({
    conversation_id: z.string().optional(),
    dependency_id: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
);
