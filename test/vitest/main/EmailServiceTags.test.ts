import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DataSource, EntitySchema } from "typeorm";

// The temp directory must exist BEFORE any @/* import resolves: importing
// EmailMarketingController → ToolExecutor → ai-chat-ipc constructs a
// `new ToolResultModule()` at module top level, whose BaseModule ctor calls
// `Token.getValue("user_dbpath")` during module evaluation — before a plain
// `const directory = ...` line would run. `vi.hoisted` runs the factory before
// the test file's imports evaluate; use `require` inside it so the factory
// does not depend on the ESM `node:*` import bindings (which are themselves in
// a temporal dead zone when the hoisted call runs).
const { directory } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- vi.hoisted runs before ESM bindings initialize (TDZ); require is the vitest-sanctioned way to use node:* here.
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- see above.
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- see above.
  const path = require("node:path") as typeof import("node:path");
  return { directory: fs.mkdtempSync(path.join(os.tmpdir(), "email-tags-")) };
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      return key === "user_dbpath" ? directory : "";
    }
  },
}));

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
vi.mock("@/modules/fieldCipher", () => ({
  userSecretKeyService: { getKey: async (): Promise<Buffer> => Buffer.alloc(32, 7) },
}));
vi.mock("@/modules/buckEmailTaskModule", () => ({ BuckEmailTaskModule: class {} }));

let database: SqliteDb;
let tags: EmailServiceTagModule;
let services: EmailServiceModule;
let controller: EmailMarketingController;
let upgradedLegacy: EmailServiceEntity | null;

/**
 * Seed a service and assign it a set of tags via the junction table.
 * Multi-tag: tagIds is an array; omit or pass [] for an untagged service.
 */
async function seedService(name: string, tagIds: number[] = []): Promise<number> {
  const entity = Object.assign(new EmailServiceEntity(), {
    name, from: `${name}@example.com`, password: "secret-smtp",
    receivePassword: "secret-receive", host: "smtp.example.com", port: "465",
    ssl: 1, status: 1,
  });
  const id = await services.createEmailService(entity);
  if (tagIds.length > 0) {
    await services.setServiceTags(id, tagIds);
  }
  return id;
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
    // The legacy row has no tags after upgrade (no backfill needed — the legacy
    // column never existed on this seed). The tagId column is gone entirely.
    expect(upgradedLegacy).toMatchObject({
      id: 1, name: "legacy", password: "ENC1:preserved-opaque-value",
    });
    expect(upgradedLegacy).not.toHaveProperty("tagId");
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
    const serviceId = await seedService("primary", [tagId]);
    const model = new EmailServiceModel(directory);
    const before = await model.read(serviceId);
    expect(before?.password).toMatch(/^ENC1:/);
    await tags.updateTag(tagId, "Campaigns");
    expect((await controller.getEmailServiceList(0, 10)).records[0].tags[0].name).toBe("Campaigns");
    expect((await tags.listTags())[0].serviceCount).toBe(1);
    expect(await tags.deleteTag(tagId)).toEqual({ affectedServiceCount: 1, servicesBecomingUntagged: 1 });
    // Deleting the only tag leaves the service untagged (junction row gone).
    expect(await services.getServiceTagIds(serviceId)).toEqual([]);
    const after = await model.read(serviceId);
    expect(after?.password).toBe(before?.password);
    expect(after?.receivePassword).toBe(before?.receivePassword);
    expect((await services.getEmailService(serviceId))?.password).toBe("secret-smtp");
  });

  it("supports multiple tags per service and counts each once", async () => {
    const tagA = await tags.createTag("Sales");
    const tagB = await tags.createTag("VIP");
    const serviceId = await seedService("primary", [tagA, tagB]);
    expect((await services.getServiceTagIds(serviceId)).sort()).toEqual([tagA, tagB].sort());
    // Both tags count the same service once.
    const summaries = await tags.listTags();
    expect(summaries.find((s) => s.id === tagA)?.serviceCount).toBe(1);
    expect(summaries.find((s) => s.id === tagB)?.serviceCount).toBe(1);
    // Deleting one tag leaves the other; service stays tagged.
    const deletion = await tags.deleteTag(tagA);
    expect(deletion.affectedServiceCount).toBe(1);
    expect(deletion.servicesBecomingUntagged).toBe(0); // still has VIP
    expect(await services.getServiceTagIds(serviceId)).toEqual([tagB]);
  });

  it("servicesBecomingUntagged stays non-negative for a service with 3+ tags", async () => {
    // Regression: countServicesLosingOnlyTag previously subtracted raw
    // relation rows (not distinct services), so a service with the target
    // tag plus two others reported -1. The delete-tag confirmation would
    // then show a negative count.
    const tagA = await tags.createTag("A");
    const tagB = await tags.createTag("B");
    const tagC = await tags.createTag("C");
    const serviceId = await seedService("multi", [tagA, tagB, tagC]);
    expect((await services.getServiceTagIds(serviceId)).sort()).toEqual(
      [tagA, tagB, tagC].sort()
    );
    const deletion = await tags.deleteTag(tagA);
    expect(deletion.affectedServiceCount).toBe(1);
    // Still has B and C — must be 0, never -1.
    expect(deletion.servicesBecomingUntagged).toBe(0);
    expect((await services.getServiceTagIds(serviceId)).sort()).toEqual(
      [tagB, tagC].sort()
    );
    // Deleting the next-to-last tag still leaves one — 0 again.
    const deletion2 = await tags.deleteTag(tagB);
    expect(deletion2.servicesBecomingUntagged).toBe(0);
    // Deleting the only remaining tag now makes the service untagged — 1.
    const deletion3 = await tags.deleteTag(tagC);
    expect(deletion3.servicesBecomingUntagged).toBe(1);
  });

  it("combines search, tag and untagged filters with matching paginated totals", async () => {
    const tagId = await tags.createTag("Sales");
    await seedService("alpha", [tagId]);
    await seedService("beta", [tagId]);
    await seedService("other");
    const filtered = await controller.getEmailServiceList(0, 1, "alpha@example", tagId);
    expect(filtered.num).toBe(1);
    expect(filtered.records[0].name).toBe("alpha");
    expect((await controller.getEmailServiceList(0, 1, undefined, tagId)).num).toBe(2);
    const untagged = await controller.getEmailServiceList(0, 10, undefined, undefined, true);
    expect(untagged.records.map((row) => row.name)).toEqual(["other"]);
    expect(untagged.num).toBe(1);
  });

  it("a multi-tag service matches filters for ANY of its tags without duplication", async () => {
    const tagA = await tags.createTag("Sales");
    const tagB = await tags.createTag("VIP");
    await seedService("both", [tagA, tagB]);
    // Filtered by tagA → 1 service. By tagB → same service (not duplicated).
    expect((await controller.getEmailServiceList(0, 10, undefined, tagA)).num).toBe(1);
    expect((await controller.getEmailServiceList(0, 10, undefined, tagB)).num).toBe(1);
    // Unfiltered list returns the service once even though it has two tags.
    const all = await controller.getEmailServiceList(0, 10);
    expect(all.records).toHaveLength(1);
    expect(all.records[0].tags.map((t) => t.name).sort()).toEqual(["Sales", "VIP"]);
  });

  it("resolves exact normalized tags and IDs without exposing credentials", async () => {
    const tagId = await tags.createTag("Marketing-US");
    const serviceId = await seedService("primary", [tagId]);
    const result = await getEmailServiceConfig({ tag: "  MARKETING-us  " });
    expect(result).toEqual(await getEmailServiceConfig({ service_id: serviceId }));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.service).toMatchObject({ id: serviceId, tags: ["Marketing-US"] });
    const listed = await listEmailServices({});
    expect(JSON.stringify(listed)).toContain("Marketing-US");
    expect(JSON.stringify([result, listed])).not.toMatch(/password|secret-smtp|secret-receive|ENC1:/);
    expect((await getEmailServiceConfig({ tag: "marketing" })).success).toBe(false);
    expect((await getEmailServiceConfig({})).success).toBe(false);
    expect((await getEmailServiceConfig({ tag: "Marketing-US", service_id: serviceId })).success).toBe(false);
    expect((await getEmailServiceConfig({ tag: "Marketing-US", unexpected: true })).success).toBe(false);
  });

  it("returns a candidate list when a shared tag matches multiple services", async () => {
    const tagId = await tags.createTag("Shared");
    expect((await getEmailServiceConfig({ tag: "Shared" })).success).toBe(false);
    const one = await seedService("one", [tagId]);
    const two = await seedService("two", [tagId]);
    const result = await getEmailServiceConfig({ tag: "Shared" });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.service).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates?.map((c) => c.id).sort()).toEqual([one, two].sort());
    expect(result.message).toContain("2");
    // Disambiguate via service_id.
    const picked = await getEmailServiceConfig({ service_id: two });
    expect(picked.success).toBe(true);
    if (!picked.success) throw new Error(picked.error);
    expect(picked.service?.id).toBe(two);
  });

  it("preserves omitted assignments, clears explicit empty, and rejects unknown IDs", async () => {
    const tagId = await tags.createTag("Sales");
    const serviceId = await seedService("primary", [tagId]);
    const payload = { id: serviceId, name: "primary", from: "primary@example.com", host: "smtp.example.com", port: "465", ssl: 1, password: "" };
    // tagIds absent → preserve existing tags.
    await controller.createEmailService(payload);
    expect(await services.getServiceTagIds(serviceId)).toEqual([tagId]);
    // Unknown ID → EMAIL_SERVICE_TAG_NOT_FOUND.
    await expect(controller.createEmailService({ ...payload, tagIds: [999999] })).rejects.toThrow("EMAIL_SERVICE_TAG_NOT_FOUND");
    // tagIds: [] → clear all tags.
    await controller.createEmailService({ ...payload, tagIds: [] });
    expect(await services.getServiceTagIds(serviceId)).toEqual([]);
  });

  it("auto-creates unknown tag names typed in the form on save", async () => {
    const serviceId = await seedService("primary");
    await controller.createEmailService({
      id: serviceId, name: "primary", from: "primary@example.com",
      host: "smtp.example.com", port: "465", ssl: 1, password: "",
      tagNames: ["NewTag", "Another"],
    });
    const newTag = await tags.findByName("newtag");
    const another = await tags.findByName("another");
    expect(newTag).toBeDefined();
    expect(another).toBeDefined();
    expect((await services.getServiceTagIds(serviceId)).sort()).toEqual(
      [newTag!.id, another!.id].sort()
    );
  });

  it("exports display names and preserves, clears, or explicitly creates imported tags", async () => {
    const tagId = await tags.createTag("Sales");
    const serviceId = await seedService("primary", [tagId]);
    const json = await controller.exportEmailServices("json");
    expect(JSON.stringify(json)).toContain('"tags":["Sales"]');
    expect(JSON.stringify(json)).not.toMatch(/password|secret-smtp|secret-receive/);
    const csv = await controller.exportEmailServices("csv");
    expect(String(csv).split("\n")[0]).toContain(",tags,");
    await controller.importEmailServices('[{"name":"primary"}]', "json");
    expect(await services.getServiceTagIds(serviceId)).toEqual([tagId]);
    await controller.importEmailServices('[{"name":"primary","tags":""}]', "json");
    expect(await services.getServiceTagIds(serviceId)).toEqual([]);
    const unknown = await controller.importEmailServices('[{"name":"primary","tags":"New"}]', "json");
    expect(unknown).toMatchObject({ imported: 0, skipped: 1 });
    expect(await tags.findByName("New")).toBeUndefined();
    const created = await controller.importEmailServices('[{"name":"primary","tags":"New"}]', "json", { createMissingTags: true });
    expect(created).toMatchObject({ imported: 1, skipped: 0 });
    expect(await services.getServiceTagIds(serviceId)).toEqual([(await tags.findByName("new"))!.id]);
    expect((await services.getEmailService(serviceId))?.password).toBe("secret-smtp");
  });

  it("imports multiple comma-separated tags from a single CSV cell", async () => {
    const tagA = await tags.createTag("Sales");
    const tagB = await tags.createTag("VIP");
    const serviceId = await seedService("primary");
    const result = await controller.importEmailServices(
      '[{"name":"primary","tags":"Sales, VIP"}]',
      "json"
    );
    expect(result).toMatchObject({ imported: 1, skipped: 0 });
    expect((await services.getServiceTagIds(serviceId)).sort()).toEqual([tagA, tagB].sort());
    // Round-trip: export then re-import preserves both tags.
    const csv = await controller.exportEmailServices("csv");
    expect(String(csv)).toContain("Sales, VIP");
  });

  it("keeps legacy untagged services and encrypted values across repeated schema initialization", async () => {
    const serviceId = await seedService("legacy");
    const model = new EmailServiceModel(directory);
    const before = await model.read(serviceId);
    await database.connection.synchronize();
    await database.connection.synchronize();
    expect(await model.read(serviceId)).toEqual(before);
    expect(await services.getServiceTagIds(serviceId)).toEqual([]);
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
