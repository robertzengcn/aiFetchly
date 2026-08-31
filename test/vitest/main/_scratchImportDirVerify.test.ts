/** THROWAWAY verification for review — delete after run. */
import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqliteDb } from "@/config/SqliteDb";

const tmpDir = path.join(os.tmpdir(), "aifetchly-scratch-importdir");

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
});

describe("importFromDirectory overwrite", () => {
  it("re-import over an existing installation succeeds and leaves files", async () => {
    const { SkillImportService } = await import("@/service/SkillImportService");
    const { SkillManagementModule } = await import(
      "@/modules/SkillManagementModule"
    );
    const src = path.join(tmpDir, "src");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(
      path.join(src, "manifest.json"),
      JSON.stringify({
        name: "scratch-exec",
        version: "1.0.0",
        description: "x",
        runtime: "javascript",
        entry: "index.js",
        parameters: { type: "object", properties: {} },
      })
    );
    fs.writeFileSync(path.join(src, "index.js"), "module.exports = () => ({});");

    const first = await SkillImportService.importFromDirectory(src);
    expect(`first: ${JSON.stringify(first)}`).toBe("logged");
    const second = await SkillImportService.importFromDirectory(src);
    // eslint-disable-next-line no-console
    console.log("SECOND RESULT:", JSON.stringify(second));
    const skillDir = path.join(
      process.cwd(),
      ".test-userData",
      "installed_skills",
      "scratch-exec"
    );
    // eslint-disable-next-line no-console
    console.log("skillDir exists:", fs.existsSync(skillDir));
    const mgmt = new SkillManagementModule();
    const row = await mgmt.getSkillByName("scratch-exec");
    // eslint-disable-next-line no-console
    console.log("db row present:", Boolean(row));
    expect(second.success).toBe(true);
  });
});
