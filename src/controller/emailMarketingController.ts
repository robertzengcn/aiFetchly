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
  SendEmailError,
  EmailServiceTagSummary,
} from "@/entityTypes/emailmarketingType";
import { EmailService } from "@/modules/lib/emailService";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";
import { incrementEmailServiceMetric } from "@/modules/lib/EmailServiceMetrics";
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
import { EmailServiceTagModule } from "@/modules/emailServiceTagModule";
import { EmailTemplateRespdata } from "@/entityTypes/emailmarketingType";
import Papa from "papaparse";

type EmailServiceImportField =
  | "name"
  | "tag"
  | "smtpUsername"
  | "from"
  | "replyTo"
  | "host"
  | "port"
  | "password"
  | "ssl"
  | "receiveProtocol"
  | "imapHost"
  | "imapPort"
  | "imapSsl"
  | "pop3Host"
  | "pop3Port"
  | "pop3Ssl"
  | "receiveUsername"
  | "receivePassword"
  | "receiveFolder"
  | "receiveEnabled";

interface ParsedEmailServiceImportRow {
  readonly values: Partial<EmailServiceEntitydata>;
  readonly presentFields: ReadonlySet<EmailServiceImportField>;
}

/** Source keys accepted for each normalized field (§10.2). */
const IMPORT_FIELD_ALIASES: Record<EmailServiceImportField, string[]> = {
  name: ["name"],
  // Accept both "tags" (current export header, multi-tag) and the legacy
  // singular "tag"/"tagname"/"tag_name" so older exports still import.
  tag: ["tags", "tag", "tagname", "tag_name"],
  smtpUsername: ["smtpUsername", "smtpusername", "smtp_username"],
  from: ["from", "from_email"],
  replyTo: ["replyTo", "replyto", "reply_to"],
  host: ["host"],
  port: ["port"],
  password: ["password"],
  ssl: ["ssl"],
  receiveProtocol: ["receiveProtocol", "receiveprotocol", "receive_protocol"],
  imapHost: ["imapHost", "imaphost", "imap_host"],
  imapPort: ["imapPort", "imapport", "imap_port"],
  imapSsl: ["imapSsl", "imapssl", "imap_ssl"],
  pop3Host: ["pop3Host", "pop3host", "pop3_host"],
  pop3Port: ["pop3Port", "pop3port", "pop3_port"],
  pop3Ssl: ["pop3Ssl", "pop3ssl", "pop3_ssl"],
  receiveUsername: ["receiveUsername", "receiveusername", "receive_username"],
  receivePassword: ["receivePassword", "receivepassword", "receive_password"],
  receiveFolder: ["receiveFolder", "receivefolder", "receive_folder"],
  receiveEnabled: ["receiveEnabled", "receiveenabled", "receive_enabled"],
};

export class EmailMarketingController {
  emailTemplateModule: EmailTemplateModuleInterface;
  emailFilterTaskRelationModule: EmailFilterTaskRelationModuleInterface;
  emailFilterModule: EmailFilterModuleInterface;
  emailServiceModule: EmailServiceModuleInterface;
  emailServiceTagModule: EmailServiceTagModule;
  emailFilterDetailModule: EmailFilterDetailModuleInterface;
  constructor() {
    this.emailTemplateModule = new EmailTemplateModule();
    this.emailFilterTaskRelationModule = new EmailFilterTaskRelationModule();
    this.emailFilterModule = new EmailFilterModule();
    this.emailServiceModule = new EmailServiceModule();
    this.emailServiceTagModule = new EmailServiceTagModule();
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
    search?: string,
    tagId?: number,
    untagged?: boolean
  ): Promise<ListData<EmailServiceListdata>> {
    const listdata = await this.emailServiceModule.listEmailServices(
      page,
      size,
      search,
      tagId,
      untagged
    );
    // Batch-expand tags for all services on the page (single junction query).
    const tagsByService = await this.emailServiceModule.getTagsForServices(
      listdata.records.map((s) => s.id)
    );
    const listdata2: EmailServiceListdata[] = listdata.records.map((item) => {
      const tags = tagsByService.get(item.id) ?? [];
      return {
        id: item.id,
        name: item.name,
        tagIds: tags.map((t) => t.id),
        tags,
        from: item.from,
        host: item.host,
        receiveProtocol: item.receiveProtocol,
        create_time: item.createdAt?.toISOString() || "",
      };
    });
    return {
      records: listdata2,
      num: listdata.num,
    };
  }
  //get email service detail
  public async getEmailServiceDetail(
    id: number
  ): Promise<EmailServiceEntitydata | undefined> {
    const entity = await this.emailServiceModule.getEmailService(id);
    if (!entity) return undefined;
    const [tagIds, tags] = await Promise.all([
      this.emailServiceModule.getServiceTagIds(id),
      this.emailServiceModule.getTagsForService(id),
    ]);
    // Credentials never round-trip to the renderer. An empty string is the
    // "unchanged" sentinel: on save, an empty password means keep existing.
    return {
      ...entity,
      tagIds,
      tags,
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

    // Resolve the desired tag set from the form payload.
    //  - tagIds absent + tagNames absent → preserve existing (update path).
    //  - tagIds: []                     → clear all tags.
    //  - tagIds: [...]                   → replace with these tags.
    //  - tagNames: ["new", ...]          → auto-create names not yet in the DB,
    //    merge their new IDs into the set (atomic with the save).
    const resolveTagIdsForSave = async (): Promise<number[] | undefined> => {
      // If neither field is present, preserve (undefined sentinel).
      if (param.tagIds === undefined && param.tagNames === undefined) {
        return undefined;
      }
      return await this.resolveFormTagIds(
        param.tagIds ?? [],
        param.tagNames ?? []
      );
    };

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
      // Apply the tag set after the row exists. undefined = preserve.
      const desiredTagIds = await resolveTagIdsForSave();
      if (desiredTagIds !== undefined) {
        await this.emailServiceModule.setServiceTags(id, desiredTagIds);
      }
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

    const newId = await this.emailServiceModule.createEmailService(entity);
    // For a brand-new service, tagIds/tagNames absent means no tags (not
    // "preserve"). Resolve whatever the form sent and assign it.
    const desiredTagIds = await resolveTagIdsForSave();
    if (desiredTagIds && desiredTagIds.length > 0) {
      await this.emailServiceModule.setServiceTags(newId, desiredTagIds);
    }
    return newId;
  }
  //update email service
  public async updateEmailService(
    id: number,
    entity: EmailServiceEntity
  ): Promise<void> {
    return await this.emailServiceModule.updateEmailService(id, entity);
  }

  /**
   * Apply the tag set from a service-form submit to an existing service row.
   * Used by the IPC update path (which updates the entity directly rather than
   * going through createEmailService). Mirrors the same semantics:
   *  - tagIds absent + tagNames absent → preserve existing tags (no-op).
   *  - tagIds: []                     → clear all tags.
   *  - tagIds: [...]                   → replace.
   *  - tagNames: ["new", ...]          → auto-create names not yet in the DB,
   *    merge their new IDs into the set.
   */
  public async applyEmailServiceTagsFromForm(
    serviceId: number,
    tagIds: number[] | undefined,
    tagNames: string[] | undefined
  ): Promise<void> {
    if (tagIds === undefined && tagNames === undefined) {
      return; // preserve
    }
    const resolved = await this.resolveFormTagIds(tagIds ?? [], tagNames ?? []);
    await this.emailServiceModule.setServiceTags(serviceId, resolved);
  }

  /**
   * Resolve a form's tag payload to a validated, deduplicated array of tag IDs.
   * Auto-creates any `tagNames` that don't yet exist (the auto-create-on-save
   * UX), tolerating a race where another caller creates the same name between
   * the findByName check and createTag. Every resulting ID is validated to
   * exist so a stale form can't attach a deleted tag.
   */
  private async resolveFormTagIds(
    tagIds: number[],
    tagNames: string[]
  ): Promise<number[]> {
    const ids = new Set<number>(tagIds);
    for (const rawName of tagNames) {
      const trimmed = rawName.trim();
      if (trimmed.length === 0) continue;
      const existing = await this.emailServiceTagModule.findByName(trimmed);
      if (existing) {
        ids.add(existing.id);
      } else {
        try {
          const newId = await this.emailServiceTagModule.createTag(trimmed);
          ids.add(newId);
        } catch (error: unknown) {
          // Race: another caller created it between findByName and create.
          if (
            error instanceof Error &&
            error.message === "EMAIL_SERVICE_TAG_DUPLICATE"
          ) {
            const race = await this.emailServiceTagModule.findByName(trimmed);
            if (race) ids.add(race.id);
          } else {
            throw error;
          }
        }
      }
    }
    return await this.resolveTagIds([...ids]);
  }

  public async listEmailServiceTags(
    search?: string
  ): Promise<EmailServiceTagSummary[]> {
    return await this.emailServiceTagModule.listTags(search);
  }

  public async createEmailServiceTag(name: string): Promise<number> {
    return await this.emailServiceTagModule.createTag(name);
  }

  public async updateEmailServiceTag(id: number, name: string): Promise<void> {
    await this.emailServiceTagModule.updateTag(id, name);
  }

  public async deleteEmailServiceTag(
    id: number
  ): Promise<{
    affectedServiceCount: number;
    servicesBecomingUntagged: number;
  }> {
    return await this.emailServiceTagModule.deleteTag(id);
  }

  /**
   * Validate that every tag ID in the array exists. Returns the validated
   * IDs as-is (duplicates removed). Throws EMAIL_SERVICE_TAG_NOT_FOUND for
   * any ID that does not resolve to a real tag.
   */
  private async resolveTagIds(tagIds: number[]): Promise<number[]> {
    if (tagIds.length === 0) return [];
    const unique = [...new Set(tagIds)];
    const resolved: number[] = [];
    for (const id of unique) {
      const tag = await this.emailServiceTagModule.getTag(id);
      if (!tag) {
        throw new Error("EMAIL_SERVICE_TAG_NOT_FOUND");
      }
      resolved.push(tag.id);
    }
    return resolved;
  }

  /**
   * Validate an email-service entity before create/update persistence
   * (§7.2: reject CR/LF in smtpUsername/from/replyTo before persistence,
   * hashing, and sending). Resolves `hasStoredPassword` from the existing
   * row on update so the empty-sentinel password rule is enforced. Throws a
   * single concatenated message on any blocking finding so the IPC handler
   * surfaces a clear error to the renderer without persisting unsafe input.
   */
  public async validateEmailServiceForSave(
    entity: EmailServiceEntity,
    mode: "create" | "update",
    existingId?: number
  ): Promise<void> {
    let hasStoredPassword = false;
    if (mode === "update" && existingId !== undefined) {
      const existing = await this.emailServiceModule.getEmailService(
        existingId
      );
      hasStoredPassword = Boolean(existing?.password);
    }
    const validation = await this.emailServiceModule.validateEmailService(
      entity,
      { mode, hasStoredPassword }
    );
    if (!validation.valid) {
      throw new Error(validation.errors.map((e) => e.message).join("; "));
    }
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

    // Batch-load tag views for every exported service so each row carries
    // its full tag set (multi-tag) without an N+1 query per service.
    const tagMap = await this.emailServiceModule.getTagsForServices(
      entities.map((e) => e.id)
    );

    const rows: SafeEmailServiceExportRow[] = entities.map((item) => {
      const identity = resolveEmailServiceIdentity({
        smtpUsername: item.smtpUsername,
        from: item.from,
        replyTo: item.replyTo,
      });
      const tags = (tagMap.get(item.id) ?? []).map((t) => t.name);
      return {
        id: item.id,
        name: item.name,
        tags,
        smtpUsername: identity.smtpUsername,
        from: item.from,
        replyTo: identity.replyToAddress,
        host: item.host,
        port: item.port,
        ssl: item.ssl,
        receiveProtocol: item.receiveProtocol,
        imapHost: item.imapHost ?? null,
        imapPort: item.imapPort ?? null,
        imapSsl: item.imapSsl ?? 1,
        pop3Host: item.pop3Host ?? null,
        pop3Port: item.pop3Port ?? null,
        pop3Ssl: item.pop3Ssl ?? 1,
        receiveUsername: item.receiveUsername ?? null,
        receiveFolder: item.receiveFolder ?? "INBOX",
        receiveEnabled: item.receiveEnabled ?? 0,
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
      "tags",
      "smtpUsername",
      "from",
      "replyTo",
      "host",
      "port",
      "ssl",
      "receiveProtocol",
      "imapHost",
      "imapPort",
      "imapSsl",
      "pop3Host",
      "pop3Port",
      "pop3Ssl",
      "receiveUsername",
      "receiveFolder",
      "receiveEnabled",
      "create_time",
    ];
    const csvRows = rows.map((row) => [
      this.escapeCsvField(row.id),
      this.escapeCsvField(row.name),
      // Multi-tag: join names with ", " so a single CSV cell carries all
      // tags. escapeCsvField re-quotes when the joined string itself
      // contains commas/quotes/newlines.
      this.escapeCsvField(row.tags.join(", ")),
      this.escapeCsvField(row.smtpUsername),
      this.escapeCsvField(row.from),
      this.escapeCsvField(row.replyTo),
      this.escapeCsvField(row.host),
      this.escapeCsvField(row.port),
      this.escapeCsvField(row.ssl),
      this.escapeCsvField(row.receiveProtocol),
      this.escapeCsvField(row.imapHost),
      this.escapeCsvField(row.imapPort),
      this.escapeCsvField(row.imapSsl),
      this.escapeCsvField(row.pop3Host),
      this.escapeCsvField(row.pop3Port),
      this.escapeCsvField(row.pop3Ssl),
      this.escapeCsvField(row.receiveUsername),
      this.escapeCsvField(row.receiveFolder),
      this.escapeCsvField(row.receiveEnabled),
      this.escapeCsvField(row.create_time),
    ]);
    const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join(
      "\n"
    );
    return csv.length > 0 ? `${csv}\n` : `${headers.join(",")}\n`;
  }

  /**
   * Quote/escape a CSV field when it contains `,`, `"`, or newline.
   * Accepts string | number | null | undefined so every CSV column —
   * including numeric ports/flags, enum protocols, and nullable hosts —
   * goes through the same escaping path (Finding 9). Null/undefined become
   * empty string; numbers are stringified.
   */
  private escapeCsvField(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return "";
    const text = typeof value === "number" ? String(value) : value;
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  // Import email services from raw file content. format: "csv" | "json".
  // Parses, maps each row to a strict field whitelist (including password),
  // validates each row, and upserts by name. id / create_time are read but
  // ignored on write. Returns counts + per-row errors with file row numbers.
  public async importEmailServices(
    content: string,
    format: "csv" | "json",
    options: { createMissingTags?: boolean } = {}
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

      // Multi-tag import: resolve each name in values.tagNames to an existing
      // tag ID, optionally creating missing ones (createMissingTags option).
      // The tag set is applied AFTER the service row exists via setServiceTags.
      //  - tag field absent  → preserve existing tags (update) / none (create)
      //  - tagNames: []      → clear all tags
      //  - tagNames: [...]   → replace with these tags
      let desiredTagIds: number[] | undefined;
      let pendingCreateNames: string[] = [];
      if (present.has("tag")) {
        const names = values.tagNames ?? [];
        if (names.length > 0) {
          const resolvedIds: number[] = [];
          const toCreate: string[] = [];
          try {
            for (const name of names) {
              const tag = await this.emailServiceTagModule.findByName(name);
              if (tag) {
                resolvedIds.push(tag.id);
              } else if (options.createMissingTags) {
                toCreate.push(name);
              } else {
                throw new Error("EMAIL_SERVICE_TAG_NOT_FOUND");
              }
            }
          } catch (error: unknown) {
            skipped++;
            const code = error instanceof Error && /^EMAIL_SERVICE_TAG_/.test(error.message)
              ? error.message
              : "EMAIL_SERVICE_TAG_LOOKUP_FAILED";
            errors.push(`row ${rowNumber}: ${code}`);
            continue;
          }
          desiredTagIds = resolvedIds;
          pendingCreateNames = toCreate;
        } else {
          // Blank tag cell = clear all tags.
          desiredTagIds = [];
        }
      }

      // 0/1 flags unparseable → row error (NaN would bind as NULL in
      // better-sqlite3). Absent/blank-skipped fields stay undefined and are
      // never NaN, so only explicitly provided garbage fails the row.
      const badFlagField = (
        ["ssl", "imapSsl", "pop3Ssl", "receiveEnabled"] as const
      ).find((field) => Number.isNaN(values[field] as number));
      if (badFlagField !== undefined) {
        skipped++;
        errors.push(`row ${rowNumber}: ${badFlagField} must be 0 or 1`);
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
        // §21 observability: an import update that kept the stored password
        // because the import row omitted/blanked it. No labels — the counter
        // never carries the password or any identity value.
        if (!(values.password && values.password.length > 0)) {
          incrementEmailServiceMetric("import_password_preserved");
        }
        candidate.receiveProtocol =
          present.has("receiveProtocol") && values.receiveProtocol
            ? values.receiveProtocol
            : ex.receiveProtocol ?? "imap";
        // §10.4 merge matrix for receive hosts/ports/ssl:
        //  absent = preserve stored, blank = clear to null (hosts/ports) /
        //  keep stored (ssl falls back via ??), value = overwrite.
        candidate.imapHost = present.has("imapHost")
          ? values.imapHost ?? null
          : ex.imapHost ?? null;
        candidate.imapPort = present.has("imapPort")
          ? values.imapPort ?? null
          : ex.imapPort ?? null;
        candidate.imapSsl = present.has("imapSsl")
          ? values.imapSsl ?? ex.imapSsl ?? 1
          : ex.imapSsl ?? 1;
        candidate.pop3Host = present.has("pop3Host")
          ? values.pop3Host ?? null
          : ex.pop3Host ?? null;
        candidate.pop3Port = present.has("pop3Port")
          ? values.pop3Port ?? null
          : ex.pop3Port ?? null;
        candidate.pop3Ssl = present.has("pop3Ssl")
          ? values.pop3Ssl ?? ex.pop3Ssl ?? 1
          : ex.pop3Ssl ?? 1;
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
        //  Receive username: absent = preserve stored, blank = reset to the
        //  runtime fallback chain (null), value = overwrite.
        candidate.receiveUsername = present.has("receiveUsername")
          ? values.receiveUsername ?? null
          : ex.receiveUsername ?? null;
        //  Receive password (like SMTP password): blank/absent NEVER clears
        //  — always preserve (§10.4); a non-empty value overwrites.
        candidate.receivePassword =
          values.receivePassword && values.receivePassword.length > 0
            ? values.receivePassword
            : ex.receivePassword;
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
        // §21 observability: an import create row that arrived without a
        // password (FR-002 requires one in create mode). Validation below will
        // reject it; this counter makes the gap visible before that. No labels
        // — never carries the password or any identity value.
        if (!values.password || values.password.length === 0) {
          incrementEmailServiceMetric("import_new_password_missing");
        }
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
        candidate.receiveUsername = values.receiveUsername ?? null;
        // Receive password is optional on create: when absent/blank the
        // runtime falls back to the SMTP password (see validateEmailService
        // and getEmailServiceReceiveConfig).
        candidate.receivePassword =
          values.receivePassword && values.receivePassword.length > 0
            ? values.receivePassword
            : null;
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
        // Create any pending tag names (createMissingTags path), tolerating
        // a race where another caller created the same name between our
        // findByName check and createTag.
        for (const name of pendingCreateNames) {
          try {
            const newId = await this.emailServiceTagModule.createTag(name);
            desiredTagIds = [...(desiredTagIds ?? []), newId];
          } catch (error: unknown) {
            if (
              error instanceof Error &&
              error.message === "EMAIL_SERVICE_TAG_DUPLICATE"
            ) {
              const race = await this.emailServiceTagModule.findByName(name);
              if (race) {
                desiredTagIds = [...(desiredTagIds ?? []), race.id];
              } else {
                throw error;
              }
            } else {
              throw error;
            }
          }
        }
        const targetId = isUpdate ? existing!.id! : await this.emailServiceModule.createEmailService(candidate);
        if (isUpdate) {
          await this.emailServiceModule.updateEmailService(targetId, candidate);
        }
        // Apply the resolved tag set after the row exists. undefined means
        // the import row omitted the tag field → preserve existing tags.
        if (desiredTagIds !== undefined) {
          await this.emailServiceModule.setServiceTags(targetId, desiredTagIds);
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

      // When aliases disagree only by blank-vs-value (no conflict), the
      // explicit value wins — found[0] may be the blank entry.
      const raw = (nonEmpty.length > 0 ? nonEmpty[0] : found[0]).raw;
      const str = this.rowValueToString(raw);
      presentFields.add(field);
      switch (field) {
        case "ssl":
          (values as Record<string, unknown>)[field] = this.parseImportSsl(str);
          break;
        case "imapSsl":
        case "pop3Ssl":
          // Unlike SMTP ssl, a blank cell must NOT flip the stored value to
          // the secure default: skip it so the merge falls back to stored.
          if (str.length > 0) {
            (values as Record<string, unknown>)[field] =
              this.parseImportSsl(str);
          }
          break;
        case "receiveEnabled": {
          // Unlike ssl, a blank cell must NOT enable receive: skip it so the
          // merge falls back to the stored value (update) or 0 (create).
          if (str.length > 0) {
            values.receiveEnabled = this.parseImportSsl(str);
          }
          break;
        }
        case "receiveProtocol": {
          const lower = str.toLowerCase();
          if (lower.length > 0) {
            if (lower !== "imap" && lower !== "pop3") {
              return {
                row: null,
                error: "receiveProtocol must be imap or pop3",
              };
            }
            (values as Record<string, unknown>).receiveProtocol =
              lower as EmailServiceEntitydata["receiveProtocol"];
          }
          break;
        }
        case "receiveFolder": {
          // Blank falls back to INBOX via the merge (same as receiveProtocol).
          if (str.length > 0) {
            values.receiveFolder = str;
          }
          break;
        }
        case "smtpUsername":
        case "receiveUsername":
          // Blank resets to the runtime fallback chain (null); the merge
          // distinguishes absent (preserve) from blank (reset) via presence.
          (values as Record<string, unknown>)[field] =
            str.length > 0 ? str : null;
          break;
        case "replyTo":
          values.replyTo = str.length > 0 ? str : null;
          break;
        case "imapHost":
        case "imapPort":
        case "pop3Host":
        case "pop3Port":
          // Blank clears to null (presence-aware merge below); absent keeps
          // the stored value.
          (values as Record<string, unknown>)[field] =
            str.length > 0 ? str : null;
          break;
        case "tag": {
          // The export serializes multi-tag as a comma-joined cell
          // ("tag1, tag2"). Split on commas, trim, drop empties. A blank
          // cell means "clear all tags"; presence + empty tagNames encodes
          // that for the import loop.
          if (str.length > 0) {
            const names = str
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part.length > 0);
            values.tagNames = names;
          } else {
            // Blank tag cell = clear. Signal via empty array + presence.
            values.tagNames = [];
          }
          break;
        }
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
    errorCall?: (error: SendEmailError) => void,
    successCallback?: () => void
  ): Promise<void> {
    try {
      const setting = await this.resolveOutboundSetting(param.Setting);
      const emailService = new EmailService(setting);
      await emailService.sendEmail(
        param.EmailRequestData,
        function (sendEmailError: SendEmailError) {
          if (errorCall) {
            errorCall(sendEmailError);
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
      // dialog reports them instead of crashing the IPC handler. These are
      // setup errors, not classified SMTP rejections, so `code` is null.
      const message = error instanceof Error ? error.message : String(error);
      if (errorCall) {
        errorCall({ message, code: null });
        return;
      }
      throw error;
    }
  }
}
