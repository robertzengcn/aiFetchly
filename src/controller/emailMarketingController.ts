//import {EmailMarketingTemplateApi} from "@/api/emailMarketingTemplateApi";
import { EmailTemplateModule } from "@/modules/EmailTemplateModule";
import { ListData } from "@/entityTypes/commonType";
import {
  EmailFilterdata,
  EmailServiceListdata,
  EmailServiceEntitydata,
  EmailSendParam,
  EmailServiceExportPayload,
  EmailServiceImportResult,
} from "@/entityTypes/emailmarketingType";
//import {EmailMarketingFilterApi} from "@/api/emailMarketingFilterApi";
//import {EmailServiceApi} from "@/api/emailServiceApi";
import { EmailService } from "@/modules/lib/emailService";
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
export class EmailMarketingController {
  emailTemplateModule: EmailTemplateModuleInterface;
  emailFilterTaskRelationModule: EmailFilterTaskRelationModuleInterface;
  emailFilterModule: EmailFilterModuleInterface;
  emailServiceModule: EmailServiceModuleInterface;
  emailFilterDetailModule: EmailFilterDetailModuleInterface;
  // emailMarketingFilterApi:EmailMarketingFilterApi
  // emailServiceApi:EmailServiceApi
  constructor() {
    this.emailTemplateModule = new EmailTemplateModule();
    this.emailFilterTaskRelationModule = new EmailFilterTaskRelationModule();
    this.emailFilterModule = new EmailFilterModule();
    this.emailServiceModule = new EmailServiceModule();
    this.emailFilterDetailModule = new EmailFilterDetailModule();
    //         this.emailMarketingTemplateApi = new EmailMarketingTemplateApi();
    //         this.emailMarketingFilterApi=new EmailMarketingFilterApi();
    // this.emailServiceApi=new EmailServiceApi();
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

    if (format === "json") {
      const rows: EmailServiceListdata[] = entities.map((item) => ({
        id: item.id,
        name: item.name,
        from: item.from,
        host: item.host,
        receiveProtocol: item.receiveProtocol,
        create_time: item.createdAt?.toISOString() || "",
      }));
      return {
        total: rows.length,
        services: rows,
        exportDate: new Date().toISOString(),
      };
    }

    const headers = [
      "id",
      "name",
      "from",
      "host",
      "port",
      "ssl",
      "receiveProtocol",
      "create_time",
    ];
    const csvRows = entities.map((item) => [
      item.id?.toString() ?? "",
      this.escapeCsvField(item.name ?? ""),
      this.escapeCsvField(item.from ?? ""),
      this.escapeCsvField(item.host ?? ""),
      item.port ?? "",
      item.ssl?.toString() ?? "",
      item.receiveProtocol ?? "",
      item.createdAt?.toISOString() ?? "",
    ]);
    const csv = [
      headers.join(","),
      ...csvRows.map((row) => row.join(",")),
    ].join("\n");
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

      // Non-object entries (e.g. null in a JSON array) can't map to a row.
      const rawRow = rows[index];
      if (!rawRow || typeof rawRow !== "object") {
        skipped++;
        errors.push(`row ${rowNumber}: invalid row entry`);
        continue;
      }

      // Field-count mismatches Papa flagged for this data row index.
      const parseError = rowErrors.get(index);
      if (parseError) {
        skipped++;
        errors.push(`row ${rowNumber}: ${parseError}`);
        continue;
      }

      const entity = this.mapImportRowToEntity(rawRow);

      // Unparseable ssl is a row error, never a silent NULL in the DB
      // (better-sqlite3 binds NaN as NULL, which would disable secure SMTP).
      if (Number.isNaN(entity.ssl)) {
        skipped++;
        errors.push(`row ${rowNumber}: ssl must be 0 or 1`);
        continue;
      }

      const name = entity.name ?? "";

      // validateEmailService covers email format, port numeric, required
      // fields (incl. password), and receive-protocol-specific rules.
      const validation = await this.emailServiceModule.validateEmailService(
        entity
      );
      if (!validation.valid) {
        skipped++;
        errors.push(`row ${rowNumber}: ${validation.errors.join("; ")}`);
        continue;
      }
      try {
        const existing = name
          ? await this.emailServiceModule.findEmailServiceByName(name)
          : undefined;
        if (existing?.id && existing.id > 0) {
          // Import files never carry inbound-receive credentials — preserve
          // the existing service's receivePassword so the update doesn't
          // wipe it (encryptCredentialsForStorage nulls absent values).
          // Other receive fields survive as undefined via TypeORM's changed-
          // column diffing; do NOT default them here — a default would
          // silently rewrite existing receive config on every import update.
          if (!entity.receivePassword || entity.receivePassword.length === 0) {
            entity.receivePassword = existing.receivePassword;
          }
          // The SMTP password IS always overwritten by the imported value
          // (import is an explicit act; the file carries the password).
          await this.emailServiceModule.updateEmailService(existing.id, entity);
        } else {
          await this.emailServiceModule.createEmailService(entity);
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
    if (format === "json") {
      const parsed: unknown = JSON.parse(content);
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
    const result = Papa.parse<Record<string, unknown>>(content, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header: string) => header.trim().toLowerCase(),
    });
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

  /** Map a parsed row record to an EmailServiceEntity (strict whitelist). */
  private mapImportRowToEntity(
    row: Record<string, unknown>
  ): EmailServiceEntity {
    const entity = new EmailServiceEntity();
    entity.name = this.rowValueToString(row.name);
    entity.from = this.rowValueToString(row.from);
    entity.host = this.rowValueToString(row.host);
    entity.port = this.rowValueToString(row.port);
    entity.password = this.rowValueToString(row.password);
    // ssl defaults to 1 (secure) when absent/blank; invalid → NaN → row error.
    entity.ssl = this.parseImportSsl(this.rowValueToString(row.ssl));
    // receiveProtocol defaults to "imap" when absent/blank.
    const protocolRaw = this.rowValueToString(
      row.receiveProtocol
    ).toLowerCase();
    entity.receiveProtocol =
      protocolRaw.length === 0
        ? "imap"
        : (protocolRaw as EmailServiceEntity["receiveProtocol"]);
    // id and create_time are read but intentionally ignored on write.
    return entity;
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

  //send email
  public async sendEmail(
    param: EmailSendParam,
    errorCall?: (errorMessage: string) => void,
    successCallback?: () => void
  ): Promise<void> {
    const emailService = new EmailService(param.Setting);
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
  }
}
