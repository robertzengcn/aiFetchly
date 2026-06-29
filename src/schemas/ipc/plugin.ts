import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { noInputSchema } from '@/schemas/ipc/_shared/common'

/** PLUGIN_LIST / PLUGIN_RELOAD: 无入参 */
export const pluginNoInputSchema = noInputSchema

/** PLUGIN_GET / PLUGIN_UNINSTALL / PLUGIN_EXPORT_DIAGNOSTICS: by name */
export const pluginByNameInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, 'name is required').max(256),
  }),
)

/** PLUGIN_IMPORT: zipPath + overwrite */
export const pluginImportInputSchema = lazySchema(() =>
  z.strictObject({
    zipPath: z.string().min(1, 'zipPath is required').max(4096),
    overwrite: z.boolean().optional(),
  }),
)

/** PLUGIN_VALIDATE_PACKAGE: zipPath */
export const pluginValidatePackageInputSchema = lazySchema(() =>
  z.strictObject({
    zipPath: z.string().min(1, 'zipPath is required').max(4096),
  }),
)

/** PLUGIN_TOGGLE: name + enabled */
export const pluginToggleInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, 'name is required').max(256),
    enabled: z.boolean(),
  }),
)

/** PLUGIN_TOGGLE_SKILL: skillName + enabled */
export const pluginToggleSkillInputSchema = lazySchema(() =>
  z.strictObject({
    skillName: z.string().min(1, 'skillName is required').max(256),
    enabled: z.boolean(),
  }),
)

/** PLUGIN_TOGGLE_MCP_SERVER: serverId + enabled */
export const pluginToggleMcpServerInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive('serverId is required'),
    enabled: z.boolean(),
  }),
)

/** PLUGIN_TOGGLE_MCP_TOOL: serverId + toolName + enabled */
export const pluginToggleMcpToolInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive('serverId is required'),
    toolName: z.string().min(1, 'toolName is required'),
    enabled: z.boolean(),
  }),
)

/** PLUGIN_TEST_MCP_CONNECTION / PLUGIN_DISCOVER_MCP_TOOLS: serverId */
export const pluginByServerIdInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive('serverId is required'),
  }),
)
