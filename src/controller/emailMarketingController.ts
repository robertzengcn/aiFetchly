import { EmailTemplateModule } from "@/modules/EmailTemplateModule";
import { ListData } from "@/entityTypes/commonType";
import {
  EmailFilterdata,
  EmailServiceListdata,
  EmailServiceEntitydata,
  EmailSendParam,
  EmailServiceExportPayload,
  EmailServiceImportResult,
  SafeEmailServiceExportRow,
} from "@/entityTypes/emailmarketingType";
import { EmailService } from "@/modules/lib/emailService";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";
import { EmailTemplateModuleInterface } from "@/modules/interface/EmailTemplateModuleInterface";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { EmailFilterTaskRelationModule } from "@/modules/EmailFilterTaskRelationModule";
import { EmailFilterTaskRelationModuleInterface } from "@/modules/interface/EmailFilterTaskRelationModuleInterface";
import { EmailFilterModuleInterface } from "@/modules/interface/EmailFilterModuleInterface";
import { EmailFilterModule } from "@/modules/EmailFilterModule";
import { EmailFilterEntity } from "@/entity/EmailFilter.entity";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailServiceModuleInterface } from "@/modules/interface/EmailServiceModuleInterface";
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";
import { EmailFilterDetailModuleInterface } from "@/modules/interface/EmailFilterDetailModuleInterface";
import { EmailFilterDetailModule } from "@/modules/EmailFilterDetailModule";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailTemplateRespdata } from "@/entityTypes/emailmarketingType";
import Papa from "papaparse";

type EmailServiceImportField =
  | "name"
  | "smtpUsername"
  | "from"
  | "replyTo"
  | "host"
  | "port"
  | "password"
  | "ssl"
  | "receiveProtocol";

interface ParsedEmailServiceImportRow {
  readonly values: Partial<EmailServiceEntitydata>;
  readonly presentFields: ReadonlySet<EmailServiceImportField>;
}

/** Source keys accepted for each normalized field (§10.2). */
const IMPORT_FIELD_ALIASES: Record<EmailServiceImportField, string[]> = {
  name: ["name"],
  smtpUsername: ["smtpUsername", "smtpusername", "smtp_username"],
  from: ["from", "from_email"],
  replyTo: ["replyTo", "replyto", "reply_to"],
  host: ["host"],
  port: ["port"],
  password: ["password"],
  ssl: ["ssl"],
  receiveProtocol: ["receiveProtocol", "receiveprotocol", "receive_protocol"],
};

export class EmailMarketingController {
  emailTemplateModule: EmailTemplateModuleInterface;
  emailFilterTaskRelationModule: EmailFilterTaskRelationModuleInterface;
  emailFilterModule: EmailFilterModuleInterface;
  emailServiceModule: EmailServiceModuleInterface;
  emailFilterDetailModule: EmailFilterDetailModuleInterface;
  constructor() {
    this.emailTemplateModule = new EmailTemplateModule();
    this.emailFilterTaskRelationModule = new EmailFilterTaskRelationModule();
    this.emailFilterModule = new EmailFilterModule();
    this.emailServiceModule = new EmailServiceModule();
    this.emailFilterDetailModule = new EmailFilterDetailModule();
  }
  //list email template
  public async listEmailTemplate(
    page: number,
    size: number,
    search?: string
  ): Promise<ListData<EmailTemplateEntity>> {
    const listdata = await this.emailTemplateModule.listEmailTemplates(
      page,
      size,
      search
    );
    const count = await this.emailTemplateModule.countEmailTemplates();
    return {
      records: listdata,
      num: count,
    };
  }
  //get email template detail
  public async getEmailTemplateDetail(
    id: number
  ): Promise<EmailTemplateEntity | undefined> {
    return await this.emailTemplateModule.read(id);
  }
  //remove email template
  public async removeEmailTemplate(id: number): Promise<void> {
    return await this.emailTemplateModule.delete(id);
  }
  //update email template
  public async updateEmailtemplate(
    param: EmailTemplateRespdata
  ): Promise<number> {
    if (param.TplId) {
      const entity = new EmailTemplateEntity();
      entity.content = param.TplContent;
      entity.description = param.TplDescription ?? null;
      entity.title = param.TplTitle;
      //entity.description = param.Description  ;
      await this.emailTemplateModule.update(param.TplId, entity);
      return param.TplId;
    } else {
      const entity = new EmailTemplateEntity();
      entity.content = param.TplContent;
      entity.description = param.TplDescription ?? null;
      entity.title = param.TplTitle;
      //entity.description=param.Description?;
      return await this.emailTemplateModule.create(entity);
    }
  }
  //list email filter
  public async listEmailFilter(
    page: number,
    size: number,
    search?: string
  ): Promise<ListData<EmailFilterEntity>> {
    const listdata = await this.emailFilterModule.listEmailFilters(
      page,
      size,
      search
    );
    const count = await this.emailFilterModule.countEmailFilters();
    return {
      records: listdata,
      num: count,
    };
  }
  // get email filter
  public async getEmailFilterDetail(
    id: number
  ): Promise<EmailFilterEntity | undefined> {
    return await this.emailFilterModule.read(id);
  }
  //get email filter detail by fileter id
  public async getEmailFilterDetailByFilterId(
    filterId: number
  ): Promise<EmailFilterDetailEntity[] | undefined> {
    const listdata =
      await this.emailFilterDetailModule.getEmailFilterDetailsByFilterId(
        filterId
      );
    return listdata;
  }
  //update email filter
  public async updateEmailFilter(param: EmailFilterdata): Promise<number> {
    if (param.filter_details) {
      param.filter_details.forEach((item) => {
        if (!item.id && !item.content) {
          //remove empty filter
          const index = param.filter_details.indexOf(item);
          param.filter_details.splice(index, 1);
        }
      });
    }
    if (param.id) {
      const entity = new EmailFilterEntity();
      entity.name = param.name;
      //entity.content=param.filter_details.map((item)=>item.content).join("\n");
      entity.description = param.description;
      await this.emailFilterModule.update(param.id, entity);
      //update filter detail
      // param.filter_details.forEach((item)=>{
      for (const item of param.filter_details) {
        const detailentity = new EmailFilterDetailEntity();
        detailentity.content = item.content;
        if (item.id) {
          detailentity.filter_id = param.id;
          await this.emailFilterDetailModule.update(item.id, detailentity);
        } else {
          detailentity.filter_id = param.id;
          await this.emailFilterDetailModule.create(detailentity);
        }
      }
      return param.id;
    } else {
      const entity = new EmailFilterEntity();
      entity.name = param.name;
      //entity.content=param.filter_details.map((item)=>item.content).join("\n");
      entity.description = param.description;
      const id = await this.emailFilterModule.create(entity);
      for (const item of param.filter_details) {
        const detailentity = new EmailFilterDetailEntity();
        detailentity.content = item.content;
        detailentity.filter_id = id;
        await this.emailFilterDetailModule.create(detailentity);
      }
      return id;
    }
  }
  //delete email filter
  public async deleteEmailFilter(id: number): Promise<void> {
    return await this.emailFilterModule.delete(id);
  }
  //get email service list
  public async getEmailServiceList(
    page: number,
    size: number,
    search?: string
  ): Promise<ListData<EmailServiceListdata>> {
    const listdata = await this.emailServiceModule.listEmailServices(
      page,
      size,
      search
    );
    const count = await this.emailServiceModule.countEmailServices();
    const listdata2: EmailServiceListdata[] = listdata.records.map((item) => {
      return {
        id: item.id,
        name: item.name,
        from: item.from,
        host: item.host,
        receiveProtocol: item.receiveProtocol,
        create_time: item.createdAt?.toISOString() || "",
      };
    });
    return {
      records: listdata2,
      num: count,
    };
  }
  //get email service detail
  public async getEmailServiceDetail(
    id: number
  ): Promise<EmailServiceEntitydata | undefined> {
    const entity = await this.emailServiceModule.getEmailService(id);
    if (!entity) return undefined;
    // Credentials never round-trip to the renderer. An empty string is the
    // "unchanged" sentinel: on save, an empty password means keep existing.
    return {
      ...entity,
      password: "",
      receivePassword: "",
    } as unknown as EmailServiceEntitydata;
  }

  /**
   * Raw entity for internal main-process callers (receive sync, send reply).
   * Carries credentials — MUST NOT be returned to the renderer or surfaced in
   * an AI tool result.
   */
  public async getEmailServiceEntity(
    id: number
  ): Promise<EmailServiceEntity | undefined> {
    return await this.emailServiceModule.getEmailService(id);
  }
  //create or update email service
  public async createEmailService(
    param: EmailServiceEntitydata
  ): Promise<number> {
    const entity = new EmailServiceEntity();
    entity.name = param.name;
    entity.host = param.host;
    entity.port = param.port;
    entity.from = param.from;
    entity.smtpUsername = param.smtpUsername ?? null;
    entity.replyTo = param.replyTo ?? null;
    entity.password = param.password;
    entity.ssl = param.ssl;
    // inbound receive fields
    entity.receiveProtocol = param.receiveProtocol ?? "imap";
    entity.imapHost = param.imapHost ?? null;
    entity.imapPort = param.imapPort ?? null;
    entity.imapSsl = param.imapSsl ?? 1;
    entity.pop3Host = param.pop3Host ?? null;
    entity.pop3Port = param.pop3Port ?? null;
    entity.pop3Ssl = param.pop3Ssl ?? 1;
    entity.receiveUsername = param.receiveUsername ?? null;
    entity.receivePassword = param.receivePassword ?? null;
    entity.receiveFolder = param.receiveFolder ?? "INBOX";
    entity.receiveEnabled = param.receiveEnabled ?? 0;

    // On update paths an empty password means "keep existing" (credentials
    // are never returned to the form, so the form sends an empty sentinel).
    const updatePreservingPasswords = async (id: number): Promise<void> => {
      const existing = await this.emailServiceModule.getEmailService(id);
      if (existing) {
        if (!entity.password || entity.password.length === 0) {
          entity.password = existing.password;
        }
        if (!entity.receivePassword || entity.receivePassword.length === 0) {
          entity.receivePassword = existing.receivePassword;
        }
      }
      await this.emailServiceModule.updateEmailService(id, entity);
    };

    if (param.id && param.id > 0) {
      await updatePreservingPasswords(param.id);
      return param.id;
    }

    const existingByName = await this.emailServiceModule.findEmailServiceByName(
      param.name
    );
    if (existingByName?.id && existingByName.id > 0) {
      await updatePreservingPasswords(existingByName.id);
      return existingByName.id;
    }

    const existingByHost =
      await this.emailServiceModule.findEmailServicesByHost(param.host);
    const existingBySender = existingByHost.find(
      (service) => service.from === param.from
    );
    if (existingBySender?.id && existingBySender.id > 0) {
      await updatePreservingPasswords(existingBySender.id);
      return existingBySender.id;
    }

    return await this.emailServiceModule.createEmailService(entity);
  }
  //update email service
  public async updateEmailService(
    id: number,
    entity: EmailServiceEntity
  ): Promise<void> {
    return await this.emailServiceModule.updateEmailService(id, entity);
  }
  //find email service by name
  public async findEmailServiceByName(
    name: string
  ): Promise<EmailServiceEntity | undefined> {
    return await this.emailServiceModule.findEmailServiceByName(name);
  }
  //delete email service
  public async deleteEmailService(id: number): Promise<void> {
    return await this.emailServiceModule.deleteEmailService(id);
  }

  // Export email services (safe fields only). format: "csv" | "json"
  public async exportEmailServices(
    format: "csv" | "json" = "csv"
  ): Promise<string | EmailServiceExportPayload> {
    const entities = await this.emailServiceModule.exportEmailServicesList();

    const rows: SafeEmailServiceExportRow[] = entities.map((item) => {
      const identity = resolveEmailServiceIdentity({
        smtpUsername: item.smtpUsername,
        from: item.from,
        replyTo: item.replyTo,
      });
      return {
        id: item.id,
        name: item.name,
        smtpUsername: identity.smtpUsername,
        from: item.from,
        replyTo: identity.replyToAddress,
        host: item.host,
        port: item.port,
        ssl: item.ssl,
        receiveProtocol: item.receiveProtocol,
        create_time: item.createdAt?.toISOString() || "",
      };
    });

    if (format === "json") {
      return {
        total: rows.length,
        services: rows,
        exportDate: new Date().toISOString(),
      };
    }

    const headers = [
      "id",
      "name",
      "smtpUsername",
      "from",
      "replyTo",
      "host",
      "port",
      "ssl",
      "receiveProtocol",
      "create_time",
    ];
    const csvRows = rows.map((row) => [
      row.id.toString(),
      this.escapeCsvField(row.name),
      this.escapeCsvField(row.smtpUsername),
      this.escapeCsvField(row.from),
      row.replyTo === null ? "" : this.escapeCsvField(row.replyTo),
      this.escapeCsvField(row.host),
      row.port,
      row.ssl.toString(),
      row.receiveProtocol,
      row.create_time,
    ]);
    const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join(
      "\n"
    );
    return csv.length > 0 ? `${csv}\n` : `${headers.join(",")}\n`;
  }

  /** Quote/escape a CSV field when it contains `,`, `"`, or newline. */
  private escapeCsvField(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  // Import email services from raw file content. format: "csv" | "json".
  // Parses, maps each row to a strict field whitelist (including password),
  // validates each row, and upserts by name. id / create_time are read but
  // ignored on write. Returns counts + per-row errors with file row numbers.
  public async importEmailServices(
    content: string,
    format: "csv" | "json"
  ): Promise<EmailServiceImportResult> {
    const { rows, rowErrors } = this.parseImportContent(content, format);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let index = 0; index < rows.length; index++) {
      // File row number: CSV header is row 1, data starts row 2; JSON array
      // index + 1. (Approximate when blank lines are skipped mid-file —
      // accepted trade-off.)
      const rowNumber = index + (format === "csv" ? 2 : 1);
      const rawRow = rows[index];
      if (!rawRow || typeof rawRow !== "object") {
        skipped++;
        errors.push(`row ${rowNumber}: invalid row entry`);
        continue;
      }
      const parseError = rowErrors.get(index);
      if (parseError) {
        skipped++;
        errors.push(`row ${rowNumber}: ${parseError}`);
        continue;
      }

      const mapped = this.mapImportRowToPresenceAware(rawRow);
      if (mapped.error) {
        skipped++;
        errors.push(`row ${rowNumber}: ${mapped.error}`);
        continue;
      }
      const parsedRow = mapped.row!;
      const values = parsedRow.values;
      const present = parsedRow.presentFields;

      // ssl unparseable → row error (NaN would bind as NULL in better-sqlite3).
      if (Number.isNaN(values.ssl as number)) {
        skipped++;
        errors.push(`row ${rowNumber}: ssl must be 0 or 1`);
        continue;
      }

      const name = values.name ?? "";
      // §10.3 — lookup BEFORE validate (password requirements depend on
      // create vs update).
      const existing = name
        ? await this.emailServiceModule.findEmailServiceByName(name)
        : undefined;
      const isUpdate = Boolean(existing?.id && existing.id > 0);

      const candidate = new EmailServiceEntity();
      if (isUpdate) {
        const ex = existing!;
        candidate.name = (values.name ?? ex.name) as string;
        candidate.host = (values.host ?? ex.host) as string;
        candidate.port = (values.port ?? ex.port) as string;
        candidate.from = (values.from ?? ex.from) as string;
        candidate.ssl = (values.ssl ?? ex.ssl) as number;
        candidate.password =
          values.password && values.password.length > 0
            ? values.password
            : ex.password; // blank/absent password NEVER clears on update (§10.4)
        candidate.receiveProtocol =
          present.has("receiveProtocol") && values.receiveProtocol
            ? values.receiveProtocol
            : ex.receiveProtocol ?? "imap";
        candidate.imapHost = values.imapHost ?? ex.imapHost ?? null;
        candidate.imapPort = values.imapPort ?? ex.imapPort ?? null;
        candidate.imapSsl = values.imapSsl ?? ex.imapSsl ?? 1;
        candidate.pop3Host = values.pop3Host ?? ex.pop3Host ?? null;
        candidate.pop3Port = values.pop3Port ?? ex.pop3Port ?? null;
        candidate.pop3Ssl = values.pop3Ssl ?? ex.pop3Ssl ?? 1;
        candidate.receiveFolder =
          values.receiveFolder ?? ex.receiveFolder ?? "INBOX";
        candidate.receiveEnabled =
          values.receiveEnabled ?? ex.receiveEnabled ?? 0;
        // §10.4 merge matrix:
        //  SMTP username: absent=Preserve stored, blank=Reset to From fallback (null).
        candidate.smtpUsername = present.has("smtpUsername")
          ? values.smtpUsername ?? null
          : ex.smtpUsername ?? null;
        //  Reply-To: absent=Preserve stored, blank=Clear to null.
        candidate.replyTo = present.has("replyTo")
          ? values.replyTo ?? null
          : ex.replyTo ?? null;
        //  Password: blank/absent NEVER clears — always preserve (§10.4).
        candidate.receivePassword = ex.receivePassword;
        candidate.receiveUsername = ex.receiveUsername ?? null;
        candidate.status = ex.status;
      } else {
        // New service: absent SMTP username → From; absent Reply-To → null;
        // password absent/blank → rejected by validation (create mode).
        candidate.name = (values.name ?? "") as string;
        candidate.host = (values.host ?? "") as string;
        candidate.port = (values.port ?? "") as string;
        candidate.from = (values.from ?? "") as string;
        candidate.ssl = (values.ssl ?? 1) as number;
        candidate.password = (values.password ?? "") as string;
        candidate.receiveProtocol = values.receiveProtocol ?? "imap";
        candidate.imapHost = values.imapHost ?? null;
        candidate.imapPort = values.imapPort ?? null;
        candidate.imapSsl = values.imapSsl ?? 1;
        candidate.pop3Host = values.pop3Host ?? null;
        candidate.pop3Port = values.pop3Port ?? null;
        candidate.pop3Ssl = values.pop3Ssl ?? 1;
        candidate.receiveFolder = values.receiveFolder ?? "INBOX";
        candidate.receiveEnabled = values.receiveEnabled ?? 0;
        candidate.smtpUsername = values.smtpUsername ?? null;
        candidate.replyTo = values.replyTo ?? null;
        candidate.receiveUsername = null;
        candidate.status = 1;
      }

      const validation = await this.emailServiceModule.validateEmailService(
        candidate,
        {
          mode: isUpdate ? "update" : "create",
          hasStoredPassword: Boolean(existing?.password),
        }
      );
      if (!validation.valid) {
        skipped++;
        errors.push(
          `row ${rowNumber}: ${validation.errors
            .map((e) => e.message)
            .join("; ")}`
        );
        continue;
      }

      try {
        if (isUpdate) {
          await this.emailServiceModule.updateEmailService(
            existing!.id!,
            candidate
          );
        } else {
          await this.emailServiceModule.createEmailService(candidate);
        }
        imported++;
      } catch (rowError) {
        skipped++;
        const reason =
          rowError instanceof Error ? rowError.message : String(rowError);
        errors.push(`row ${rowNumber}: ${reason}`);
      }
    }

    // Cap reported errors to the first 10 to keep the snackbar readable.
    const cappedErrors = errors.slice(0, 10);
    return { imported, skipped, errors: cappedErrors };
  }

  /** Parse raw import content into rows + per-row parse errors. Throws on malformed input. */
  private parseImportContent(
    content: string,
    format: "csv" | "json"
  ): { rows: Record<string, unknown>[]; rowErrors: Map<number, string> } {
    // Strip a leading BOM (U+FEFF) — common in Excel-on-Windows and Notepad
    // exports. JSON.parse rejects it outright; on the CSV side it would land
    // in the first header name unless stripped (done here explicitly rather
    // than relying on the transformHeader trim()).
    const sanitized = content.replace(/^\uFEFF/, "");
    if (format === "json") {
      const parsed: unknown = JSON.parse(sanitized);
      // Export shape { total, services, exportDate } or bare array.
      if (Array.isArray(parsed)) {
        return {
          rows: parsed as Record<string, unknown>[],
          rowErrors: new Map(),
        };
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { services?: unknown }).services)
      ) {
        return {
          rows: (parsed as { services: Record<string, unknown>[] }).services,
          rowErrors: new Map(),
        };
      }
      throw new Error("Invalid JSON structure for import");
    }

    // CSV — header row, case-insensitive columns. "greedy" also skips
    // whitespace-only lines (stray-space lines are common in hand-edited
    // CSVs; with plain `true` they surface as TooFewFields errors).
    const result = Papa.parse<Record<string, unknown>>(sanitized, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header: string) => header.trim().toLowerCase(),
    });
    // A file with no data rows whose only Papa errors are an undetectable
    // delimiter (0-byte, whitespace-only, BOM-only, header-only, or text
    // without row breaks) is an empty-in-effect file, not a malformed one:
    // return zero rows so the caller reports "no valid rows"
    // (import_no_valid_rows) instead of "invalid file".
    if (
      (result.data?.length ?? 0) === 0 &&
      (result.errors ?? []).every(
        (parseError) => parseError.code === "UndetectableDelimiter"
      )
    ) {
      return { rows: [], rowErrors: new Map() };
    }
    const rowErrors = new Map<number, string>();
    for (const parseError of result.errors ?? []) {
      // Field-count mismatches are row-level problems: collect them keyed by
      // Papa's 0-based data row index so the rest of the file still imports
      // (partial-import semantics). All other errors (quotes, delimiter)
      // are structural: the file is invalid as a whole. Match on the stable
      // ParseError.type discriminator from @types/papaparse.
      if (
        parseError.type === "FieldMismatch" &&
        parseError.row !== undefined &&
        parseError.row >= 0
      ) {
        rowErrors.set(parseError.row, parseError.message);
        continue;
      }
      throw new Error(`CSV parse error: ${parseError.message}`);
    }
    return { rows: result.data, rowErrors };
  }

  /**
   * Map a parsed row to a presence-aware import row (§10.1/§10.2). Tracks
   * which fields were PRESENT so the merge step can distinguish absent
   * (preserve) from blank (clear/reset). Rejects rows where two aliases for
   * one field carry different non-empty values (duplicate_field_conflict).
   */
  private mapImportRowToPresenceAware(row: Record<string, unknown>): {
    row: ParsedEmailServiceImportRow | null;
    error: string | null;
  } {
    const values: Partial<EmailServiceEntitydata> = {};
    const presentFields = new Set<EmailServiceImportField>();

    for (const field of Object.keys(
      IMPORT_FIELD_ALIASES
    ) as EmailServiceImportField[]) {
      const aliases = IMPORT_FIELD_ALIASES[field];
      const found: { alias: string; raw: unknown }[] = [];
      for (const alias of aliases) {
        // CSV headers are lowercased by transformHeader; JSON keys keep their
        // case — check both the alias and its lowercase form.
        if (Object.prototype.hasOwnProperty.call(row, alias)) {
          found.push({ alias, raw: row[alias] });
        } else if (
          alias !== alias.toLowerCase() &&
          Object.prototype.hasOwnProperty.call(row, alias.toLowerCase())
        ) {
          found.push({ alias, raw: row[alias.toLowerCase()] });
        }
      }
      if (found.length === 0) continue;

      // duplicate_field_conflict: two aliases, different non-empty values.
      const nonEmpty = found.filter(
        (f) =>
          f.raw !== null &&
          f.raw !== undefined &&
          String(f.raw).trim().length > 0
      );
      const distinctValues = new Set(nonEmpty.map((f) => String(f.raw).trim()));
      if (distinctValues.size > 1) {
        return {
          row: null,
          error: "duplicate_field_conflict",
        };
      }

      const raw = found[0].raw;
      const str = this.rowValueToString(raw);
      presentFields.add(field);
      switch (field) {
        case "ssl":
          (values as Record<string, unknown>).ssl = this.parseImportSsl(str);
          break;
        case "receiveProtocol": {
          const lower = str.toLowerCase();
          if (lower.length > 0) {
            (values as Record<string, unknown>).receiveProtocol =
              lower as EmailServiceEntitydata["receiveProtocol"];
          }
          break;
        }
        case "smtpUsername":
          values.smtpUsername = str.length > 0 ? str : null;
          break;
        case "replyTo":
          values.replyTo = str.length > 0 ? str : null;
          break;
        default:
          (values as Record<string, unknown>)[field] = str;
      }
    }

    return { row: { values, presentFields }, error: null };
  }

  /**
   * Parse a row's ssl value to 0/1. Blank defaults to 1 (secure);
   * true/false/yes/no coerce to 1/0; 0/1 pass through. Anything else
   * returns NaN — the import loop turns that into a row error so an
   * unparseable ssl never reaches the DB (where it would bind as NULL
   * and silently disable secure SMTP).
   */
  private parseImportSsl(raw: string): number {
    const normalized = raw.toLowerCase();
    if (normalized.length === 0) return 1;
    if (normalized === "true" || normalized === "yes") return 1;
    if (normalized === "false" || normalized === "no") return 0;
    const numeric = Number(normalized);
    return numeric === 0 || numeric === 1 ? numeric : NaN;
  }

  /** Coerce a possibly non-string row value (JSON numbers) to a trimmed string. */
  private rowValueToString(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  /**
   * Resolve the outbound SMTP setting for a send, swapping the empty-password
   * credential sentinel for the stored password.
   *
   * Credentials never round-trip to the renderer: getEmailServiceDetail returns
   * password: "" and an empty password on save means "keep existing". The same
   * sentinel arrives on a test-email send from the edit page, so the stored
   * row must be resolved by id and its password reused — otherwise the send
   * fires with an empty SMTP password and fails auth.
   *
   * Returns a NEW setting object; the caller's setting is not mutated.
   */
  public async resolveOutboundSetting(
    setting: EmailServiceEntitydata
  ): Promise<EmailServiceEntitydata> {
    const hasPassword =
      typeof setting.password === "string" && setting.password.length > 0;
    if (hasPassword) {
      return { ...setting };
    }
    const id = setting.id;
    if (id === undefined || id === null || Number(id) <= 0) {
      // Create-mode send with no id: nothing to resolve against.
      return { ...setting };
    }
    const existing = await this.emailServiceModule.getEmailService(Number(id));
    if (!existing) {
      throw new Error(`Email service ${id} not found`);
    }
    if (!existing.password || existing.password.length === 0) {
      throw new Error(`Email service ${id} has no stored password`);
    }
    return { ...setting, password: existing.password };
  }

  //send email
  public async sendEmail(
    param: EmailSendParam,
    errorCall?: (errorMessage: string) => void,
    successCallback?: () => void
  ): Promise<void> {
    try {
      const setting = await this.resolveOutboundSetting(param.Setting);
      const emailService = new EmailService(setting);
      await emailService.sendEmail(
        param.EmailRequestData,
        function (errorString) {
          if (errorCall) {
            errorCall(errorString);
          }
        },
        function () {
          if (successCallback) {
            successCallback();
          }
        }
      );
    } catch (error: unknown) {
      // Resolution failures (missing service / no stored password) surface
      // through the same error channel as SMTP failures so the test-email
      // dialog reports them instead of crashing the IPC handler.
      const message = error instanceof Error ? error.message : String(error);
      if (errorCall) {
        errorCall(message);
        return;
      }
      throw error;
    }
  }
}
