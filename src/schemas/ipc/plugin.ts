import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

/** PLUGIN_LIST / PLUGIN_RELOAD: 无入参 */
export const pluginNoInputSchema = noInputSchema;

/** PLUGIN_GET / PLUGIN_UNINSTALL / PLUGIN_EXPORT_DIAGNOSTICS: by name */
export const pluginByNameInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, "name is required").max(256),
  })
);

/** PLUGIN_IMPORT: zipPath + overwrite */
export const pluginImportInputSchema = lazySchema(() =>
  z.strictObject({
    zipPath: z.string().min(1, "zipPath is required").max(4096),
    overwrite: z.boolean().optional(),
  })
);

/** PLUGIN_VALIDATE_PACKAGE: zipPath */
export const pluginValidatePackageInputSchema = lazySchema(() =>
  z.strictObject({
    zipPath: z.string().min(1, "zipPath is required").max(4096),
  })
);

/**
 * PLUGIN_INSTALL_FROM_SOURCE (design §12.2): STRICT schema — no passthrough,
 * no signal/callbacks/arbitrary sourceMeta from the renderer. operationId
 * keys the main-process AbortController; kind-specific required fields are
 * checked by the handler (the unions differ per kind).
 */
const boundedSafeString = z.string().min(1).max(2000);
export const pluginInstallFromSourceInputSchema = lazySchema(() =>
  z.strictObject({
    operationId: z.string().uuid(),
    kind: z.enum(["local-zip", "local-folder", "git", "github", "npm", "url"]),
    overwrite: z.boolean().optional(),
    zipPath: boundedSafeString.optional(),
    folderPath: boundedSafeString.optional(),
    uri: boundedSafeString.optional(),
    ref: boundedSafeString.optional(),
    npmPackage: boundedSafeString.optional(),
    npmVersion: boundedSafeString.optional(),
    npmRegistry: boundedSafeString.optional(),
    npmAuthScope: boundedSafeString.optional(),
    npmAuthToken: boundedSafeString.optional(),
  })
);

/** PLUGIN_CANCEL_INSTALL (design §12.4): abort one active install. */
export const pluginCancelInstallInputSchema = lazySchema(() =>
  z.strictObject({
    operationId: z.string().uuid(),
  })
);

/** PLUGIN_TOGGLE: name + enabled */
export const pluginToggleInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, "name is required").max(256),
    enabled: z.boolean(),
  })
);

/** PLUGIN_TOGGLE_SKILL: skillName + enabled */
export const pluginToggleSkillInputSchema = lazySchema(() =>
  z.strictObject({
    skillName: z.string().min(1, "skillName is required").max(256),
    enabled: z.boolean(),
  })
);

/** PLUGIN_TOGGLE_MCP_SERVER: serverId + enabled */
export const pluginToggleMcpServerInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive("serverId is required"),
    enabled: z.boolean(),
  })
);

/** PLUGIN_TOGGLE_MCP_TOOL: serverId + toolName + enabled */
export const pluginToggleMcpToolInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive("serverId is required"),
    toolName: z.string().min(1, "toolName is required"),
    enabled: z.boolean(),
  })
);

/** PLUGIN_TEST_MCP_CONNECTION / PLUGIN_DISCOVER_MCP_TOOLS: serverId */
export const pluginByServerIdInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive("serverId is required"),
  })
);

/** PLUGIN_GET_MCP_OPTIONS: read all options for a plugin */
export const pluginGetMcpOptionsInputSchema = lazySchema(() =>
  z.strictObject({
    pluginName: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, "Invalid plugin name"),
  })
);

/** PLUGIN_SET_MCP_OPTION: set a single option value */
export const pluginSetMcpOptionInputSchema = lazySchema(() =>
  z.strictObject({
    pluginName: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, "Invalid plugin name"),
    scopedServerName: z.string().min(1),
    varName: z
      .string()
      .min(1)
      .regex(/^[A-Z_][A-Z0-9_]*$/, "Var name must be UPPER_SNAKE_CASE"),
    value: z.string(),
  })
);
