import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataSource, EntitySchema } from "typeorm";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailServiceTagEntity } from "@/entity/EmailServiceTag.entity";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailServiceTagModule } from "@/modules/emailServiceTagModule";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailMarketingController } from "@/controller/emailMarketingController";
import { getEmailServiceConfig, listEmailServices } from "@/service/EmailMarketingAiTools";
import {
  emailServiceListInputSchema,
  emailServiceTagCreateInputSchema,
  emailServiceTagUpdateInputSchema,
  emailServiceTagDeleteInputSchema,
} from "@/schemas/ipc/emailMarketing";

const directory = mkdtempSync(join(tmpdir(), "email-tags-"));
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      return key === "user_dbpath" ? directory : "";
    }
  },
}));
vi.mock("@/modules/fieldCipher", () => ({
  userSecretKeyService: { getKey: async (): Promise<Buffer> => Buffer.alloc(32, 7) },
}));
vi.mock("@/modules/buckEmailTaskModule", () => ({ BuckEmailTaskModule: class {} }));

let database: SqliteDb;
let tags: EmailServiceTagModule;
let services: EmailServiceModule;
let controller: EmailMarketingController;
let upgradedLegacy: EmailServiceEntity | null;

async function seedService(name: string, tagId: number | null = null): Promise<number> {
  const entity = Object.assign(new EmailServiceEntity(), {
    name, tagId, from: `${name}@example.com`, password: "secret-smtp",
    receivePassword: "secret-receive", host: "smtp.example.com", port: "465",
    ssl: 1, status: 1,
  });
  return await services.createEmailService(entity);
}

beforeAll(async () => {
  const legacy = new DataSource({
    type: "better-sqlite3",
    database: join(directory, "scraper.db"),
    synchronize: true,
    entities: [new EntitySchema({
      name: "LegacyEmailService",
      tableName: "email_service",
      columns: {
        id: { type: Number, primary: true, generated: true },
        name: { type: String },
        from: { type: String },
        password: { type: String },
        host: { type: String },
        port: { type: String },
        ssl: { type: Number, default: 1 },
        status: { type: Number, default: 1 },
      },
    })],
  });
  await legacy.initialize();
  await legacy.getRepository("LegacyEmailService").save({
    id: 1, name: "legacy", from: "legacy@example.com", password: "ENC1:preserved-opaque-value",
    host: "smtp.example.com", port: "465",
  });
  await legacy.destroy();
  database = await SqliteDb.resetInstance(directory);
  await SqliteDb.ensureInitialized();
  upgradedLegacy = await database.connection.getRepository(EmailServiceEntity).findOneBy({ id: 1 });
});

beforeEach(async () => {
  await database.connection.getRepository(EmailServiceEntity).clear();
  await database.connection.getRepository(EmailServiceTagEntity).clear();
  tags = new EmailServiceTagModule();
  services = new EmailServiceModule();
  controller = new EmailMarketingController();
});

afterAll(async () => {
  if (database?.connection.isInitialized) await database.connection.destroy();
  rmSync(directory, { recursive: true, force: true });
});

describe("email service tag persistence and AI resolution", () => {
  it("upgrades an existing database without modifying service IDs or encrypted values", () => {
    expect(upgradedLegacy).toMatchObject({
      id: 1, name: "legacy", tagId: null, password: "ENC1:preserved-opaque-value",
    });
  });
  it("normalizes names and enforces uniqueness during concurrent creation and rename", async () => {
    const results = await Promise.allSettled([tags.createTag(" Sales "), tags.createTag("sales")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const tag = await tags.findByName(" SALES ");
    expect(tag?.normalizedName).toBe("sales");
    const other = await tags.createTag("Support");
    await expect(tags.updateTag(other, "sALES")).rejects.toThrow("EMAIL_SERVICE_TAG_DUPLICATE");
    await tags.updateTag(tag!.id, "SALES");
    expect((await tags.getTag(tag!.id))?.name).toBe("SALES");
  });

  it.each(["", " ".repeat(3), "a".repeat(65), "\nSales", "bad\u0000tag"])(
    "rejects invalid tag name %j",
    async (name) => {
      await expect(tags.createTag(name)).rejects.toThrow("EMAIL_SERVICE_TAG_");
      expect(await tags.listTags()).toEqual([]);
    }
  );

  it("renames live references and deletes only assignments, preserving encrypted credentials", async () => {
    const tagId = await tags.createTag("Marketing");
    const serviceId = await seedService("primary", tagId);
    const model = new EmailServiceModel(directory);
    const before = await model.read(serviceId);
    expect(before?.password).toMatch(/^ENC1:/);
    await tags.updateTag(tagId, "Campaigns");
    expect((await controller.getEmailServiceList(0, 10)).records[0].tag).toBe("Campaigns");
    expect((await tags.listTags())[0].serviceCount).toBe(1);
    expect(await tags.deleteTag(tagId)).toEqual({ affectedServiceCount: 1 });
    const after = await model.read(serviceId);
    expect(after?.tagId).toBeNull();
    expect(after?.password).toBe(before?.password);
    expect(after?.receivePassword).toBe(before?.receivePassword);
    expect((await services.getEmailService(serviceId))?.password).toBe("secret-smtp");
  });

  it("combines search, tag and untagged filters with matching paginated totals", async () => {
    const tagId = await tags.createTag("Sales");
    await seedService("alpha", tagId);
    await seedService("beta", tagId);
    await seedService("other");
    const filtered = await controller.getEmailServiceList(0, 1, "alpha@example", tagId);
    expect(filtered.num).toBe(1);
    expect(filtered.records[0].name).toBe("alpha");
    expect((await controller.getEmailServiceList(0, 1, undefined, tagId)).num).toBe(2);
    const untagged = await controller.getEmailServiceList(0, 10, undefined, undefined, true);
    expect(untagged.records.map((row) => row.name)).toEqual(["other"]);
    expect(untagged.num).toBe(1);
  });

  it("resolves exact normalized tags and IDs without exposing credentials", async () => {
    const tagId = await tags.createTag("Marketing-US");
    const serviceId = await seedService("primary", tagId);
    const result = await getEmailServiceConfig({ tag: "  MARKETING-us  " });
    expect(result).toEqual(await getEmailServiceConfig({ service_id: serviceId }));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.service).toMatchObject({ id: serviceId, tag: "Marketing-US" });
    const listed = await listEmailServices({});
    expect(JSON.stringify(listed)).toContain("Marketing-US");
    expect(JSON.stringify([result, listed])).not.toMatch(/password|secret-smtp|secret-receive|ENC1:/);
    expect((await getEmailServiceConfig({ tag: "marketing" })).success).toBe(false);
    expect((await getEmailServiceConfig({})).success).toBe(false);
    expect((await getEmailServiceConfig({ tag: "Marketing-US", service_id: serviceId })).success).toBe(false);
    expect((await getEmailServiceConfig({ tag: "Marketing-US", unexpected: true })).success).toBe(false);
  });

  it("fails closed when a shared tag matches multiple services or no services", async () => {
    const tagId = await tags.createTag("Shared");
    expect((await getEmailServiceConfig({ tag: "Shared" })).success).toBe(false);
    await seedService("one", tagId);
    await seedService("two", tagId);
    const result = await getEmailServiceConfig({ tag: "Shared" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Unexpected resolution");
    expect(result.error).toContain("ambiguous");
  });

  it("preserves omitted assignments, clears explicit null, and rejects unknown IDs", async () => {
    const tagId = await tags.createTag("Sales");
    const serviceId = await seedService("primary", tagId);
    const payload = { id: serviceId, name: "primary", from: "primary@example.com", host: "smtp.example.com", port: "465", ssl: 1, password: "" };
    await controller.createEmailService(payload);
    expect((await services.getEmailService(serviceId))?.tagId).toBe(tagId);
    await expect(controller.createEmailService({ ...payload, tagId: 999999 })).rejects.toThrow("EMAIL_SERVICE_TAG_NOT_FOUND");
    await controller.createEmailService({ ...payload, tagId: null });
    expect((await services.getEmailService(serviceId))?.tagId).toBeNull();
  });

  it("exports display names and preserves, clears, or explicitly creates imported tags", async () => {
    const tagId = await tags.createTag("Sales");
    const serviceId = await seedService("primary", tagId);
    const json = await controller.exportEmailServices("json");
    expect(JSON.stringify(json)).toContain('"tag":"Sales"');
    expect(JSON.stringify(json)).not.toMatch(/password|secret-smtp|secret-receive/);
    const csv = await controller.exportEmailServices("csv");
    expect(String(csv).split("\n")[0]).toContain(",tag,");
    await controller.importEmailServices('[{"name":"primary"}]', "json");
    expect((await services.getEmailService(serviceId))?.tagId).toBe(tagId);
    await controller.importEmailServices('[{"name":"primary","tag":""}]', "json");
    expect((await services.getEmailService(serviceId))?.tagId).toBeNull();
    const unknown = await controller.importEmailServices('[{"name":"primary","tag":"New"}]', "json");
    expect(unknown).toMatchObject({ imported: 0, skipped: 1 });
    expect(await tags.findByName("New")).toBeUndefined();
    const created = await controller.importEmailServices('[{"name":"primary","tag":"New"}]', "json", { createMissingTags: true });
    expect(created).toMatchObject({ imported: 1, skipped: 0 });
    expect((await services.getEmailService(serviceId))?.tagId).toBe((await tags.findByName("new"))?.id);
    expect((await services.getEmailService(serviceId))?.password).toBe("secret-smtp");
  });

  it("keeps legacy untagged services and encrypted values across repeated schema initialization", async () => {
    const serviceId = await seedService("legacy");
    const model = new EmailServiceModel(directory);
    const before = await model.read(serviceId);
    await database.connection.synchronize();
    await database.connection.synchronize();
    expect(await model.read(serviceId)).toEqual(before);
    expect(before?.tagId).toBeNull();
  });
});

describe("tag IPC contracts", () => {
  it("rejects malformed IDs, control characters, extra fields and conflicting filters", () => {
    expect(emailServiceTagCreateInputSchema().safeParse({ name: "Sales", normalizedName: "sales" }).success).toBe(false);
    expect(emailServiceTagCreateInputSchema().safeParse({ name: "\nSales" }).success).toBe(false);
    expect(emailServiceTagUpdateInputSchema().safeParse({ id: 0, name: "Sales" }).success).toBe(false);
    expect(emailServiceTagDeleteInputSchema().safeParse({ id: "1" }).success).toBe(false);
    expect(emailServiceListInputSchema().safeParse({ tagId: 1, untagged: true }).success).toBe(false);
  });
});
