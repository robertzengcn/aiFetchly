import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * MCP Server 配置 schema。
 *
 * 对应 src/service/MCPToolService.ts 的 MCPServerConfig interface。
 * 在 service 边界（addMCPServer / updateMCPServer）做 safeParse，拒绝
 * 畸形 config（缺 serverName、transport 不在枚举内、authType 非法等）。
 *
 * 设计选择：
 *  - serverName 必填非空字符串（DB 主键约束）
 *  - transport 是 enum，与 MCPServerConfig 的字面量联合对齐
 *  - authType 用 enum，缺省 'none'
 *  - authConfig/metadata 是 Record，schema 不深校验内部结构（应用层自行解析）
 *  - port/timeout 用 number + 范围约束（port 1-65535, timeout 正整数）
 */
export const mcpServerConfigSchema = lazySchema(() =>
  z.strictObject({
    serverName: z.string().min(1, 'serverName is required').max(128),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    transport: z.enum(['stdio', 'sse', 'websocket']),
    enabled: z.boolean().optional(),
    authType: z
      .enum(['none', 'api_key', 'bearer_token', 'custom'])
      .optional(),
    authConfig: z.record(z.string(), z.unknown()).optional(),
    timeout: z.number().int().positive().max(600000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
)

/**
 * UPDATE 路径用：Partial<MCPServerConfig>。
 *
 * 所有字段都可选；service 层会按需更新 DB 列。
 */
export const mcpServerConfigUpdateSchema = lazySchema(() =>
  z.strictObject({
    serverName: z.string().min(1).max(128).optional(),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    transport: z.enum(['stdio', 'sse', 'websocket']).optional(),
    enabled: z.boolean().optional(),
    authType: z.enum(['none', 'api_key', 'bearer_token', 'custom']).optional(),
    authConfig: z.record(z.string(), z.unknown()).optional(),
    timeout: z.number().int().positive().max(600000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
)
