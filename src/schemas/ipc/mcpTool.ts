import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

/** LIST: 无入参 */
export const mcpToolListInputSchema = noInputSchema;

/**
 * ADD: MCPServerConfig 透传。
 *
 * MCPServerConfig 由 service.addMCPServer 内部消费，字段较多且可能扩展，
 * schema 不强校验内部字段，只保证是对象。
 */
export const mcpToolAddInputSchema = lazySchema(() =>
  z.object({}).passthrough()
);

/** UPDATE: id + Partial<MCPServerConfig> */
export const mcpToolUpdateInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
    config: z.object({}).passthrough(),
  })
);

/** DELETE / TEST_CONNECTION by server id */
export const mcpToolByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
  })
);

/** DISCOVER: serverId */
export const mcpToolDiscoverInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive("serverId is required"),
  })
);

/** TOGGLE_SERVER: id + enabled */
export const mcpToolToggleServerInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
    enabled: z.boolean(),
  })
);

/** TOGGLE_TOOL: serverId + toolName + enabled */
export const mcpToolToggleToolInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive("serverId is required"),
    toolName: z.string().min(1, "toolName is required"),
    enabled: z.boolean(),
  })
);

/** TRUST: serverId + trusted (F1 fix — explicit approval gate for stdio spawn) */
export const mcpToolTrustInputSchema = lazySchema(() =>
  z.strictObject({
    serverId: z.number().int().positive("serverId is required"),
    trusted: z.boolean(),
  })
);
