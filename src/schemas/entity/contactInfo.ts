import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * ContactInfoEntity 写入边界 schema。
 *
 * Worker 抓取输出的 data 形态不固定 —— 可能包含 {emails: [], phones: [],
 * address, socialLinks} 等字段，也可能意外带上 future 字段或脏数据。
 * 落库前用此 schema 通过 parseAndStrip 过滤未知字段，确保 TypeORM entity
 * 只接收声明的列。
 *
 * 字段对齐 src/entity/ContactInfo.entity.ts 的 @Column 列：
 *  - email/phone/address: text 列，schema 接受 string | null
 *  - socialLinks: json 列，schema 接受 string[] | null
 *  - extractionStatus: text 列，限定到 entity 允许的状态枚举
 */
export const contactInfoWriteSchema = lazySchema(() =>
  z.object({
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    socialLinks: z.array(z.string()).nullable().optional(),
    extractionStatus: z
      .enum(['pending', 'analyzing', 'completed', 'failed'])
      .optional(),
    extractionError: z.string().nullable().optional(),
    extractionMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
)
