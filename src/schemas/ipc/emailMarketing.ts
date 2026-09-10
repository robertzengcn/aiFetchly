import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { itemSearchParamSchema } from "@/schemas/ipc/_shared/pagination";

/** LIST handlers (TPL/FILTER/SERVICE): pagination */
export const emailMarketingListInputSchema = itemSearchParamSchema;

/**
 * EMAILSERVICEEXPORT: optional format enum; renderer may send {}.
 */
export const emailServiceExportInputSchema = lazySchema(() =>
  z.strictObject({
    format: z.enum(["csv", "json"]).optional(),
  })
);

/**
 * EMAILSERVICEIMPORT: the renderer sends no data — the file path is chosen
 * via the native open dialog in the main process. An empty strict object
 * validates that no unexpected payload crosses the boundary.
 */
export const emailServiceImportInputSchema = lazySchema(() =>
  z.strictObject({})
);

/**
 * By-id handlers (REMOVE/DETAIL/DELETE).
 *
 * 原代码 CommonIdrequest<string>，handler 内 Number(qdata.id) 转换。
 * schema 接受 number 或字符串数字，handler 内统一转 number。
 */
export const emailMarketingByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.union([z.number(), z.string().min(1)]),
  })
);

/**
 * UPDATE handlers — 3 个不同 entity 的 update，统一用 passthrough。
 *
 * - TEMPUPDATE: EmailTemplateRespdata
 * - FILTERUPDATE / SERVICEUPDATE: 各自复杂结构
 * schema 只保证对象非空，透传给 controller 内部消费。
 */
export const emailMarketingUpdateInputSchema = lazySchema(() =>
  z.object({}).passthrough()
);

/**
 * EMAILSERVICEUPDATE — dedicated schema bounding the security-relevant
 * identity fields (§12.4). The shared passthrough schema above stays for
 * TEMPUPDATE/FILTERUPDATE; the email-service update must NOT rely on
 * `.passthrough()` for smtpUsername/from/replyTo.
 *
 * NOTE on CR/LF (§7.2): this schema bounds LENGTH only (`.max(...)`). It
 * does NOT reject `\r`/`\n` in smtpUsername/from/replyTo — that header-
 * injection defense lives in `EmailServiceModule.validateEmailService` via
 * `containsEmailHeaderBreak`. The EMAILSERVICEUPDATE handler does NOT yet
 * call `validateEmailService` before persistence (pre-existing behavior; the
 * import path at `emailMarketingController` does validate). Wiring validation
 * into this handler is a tracked follow-up; until then a CR/LF value can be
 * persisted from the update/create path. The schema is NOT the complete
 * security boundary for identity fields.
 */
export const emailServiceUpdateInputSchema = lazySchema(() =>
  z.object({
    id: z.union([z.number(), z.string().min(1)]).optional(),
    name: z.string().max(255).optional(),
    smtpUsername: z.string().max(255).nullable().optional(),
    from: z.string().min(1).max(255),
    replyTo: z.string().max(320).nullable().optional(),
    password: z.string().optional(),
    host: z.string().max(255).optional(),
    port: z.string().max(10).optional(),
    ssl: z.number().optional(),
    receiveProtocol: z.string().max(10).optional(),
    imapHost: z.string().max(255).nullable().optional(),
    imapPort: z.string().max(10).nullable().optional(),
    imapSsl: z.number().optional(),
    pop3Host: z.string().max(255).nullable().optional(),
    pop3Port: z.string().max(10).nullable().optional(),
    pop3Ssl: z.number().optional(),
    receiveUsername: z.string().max(255).nullable().optional(),
    receivePassword: z.string().nullable().optional(),
    receiveFolder: z.string().max(255).optional(),
    receiveEnabled: z.number().optional(),
  })
);
