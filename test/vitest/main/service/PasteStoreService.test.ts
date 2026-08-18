import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PasteStoreService } from "@/service/pastedText/PasteStoreService";

describe("PasteStoreService", () => {
  it("writes content-addressed files and can read them back", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "aifetchly-paste-"));
    try {
      const store = new PasteStoreService(tmp);
      const content = "hello\nworld";
      const hash = await store.write(content);

      const read = await store.read(hash);
      expect(read).toBe(content);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("cleanupOldPastes deletes aged files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "aifetchly-paste-"));
    try {
      const store = new PasteStoreService(tmp);

      const freshContent = "fresh";
      const oldContent = "old";
      const freshHash = await store.write(freshContent);
      const oldHash = await store.write(oldContent);

      const now = new Date();
      const oldMtime = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const oldPath = path.join(tmp, `${oldHash}.txt`);
      await fs.utimes(oldPath, oldMtime, oldMtime);

      await store.cleanupOldPastes(1 /* maxAgeDays */, 500 /* maxFiles */);

      expect(await store.read(oldHash)).toBeNull();
      expect(await store.read(freshHash)).toBe(freshContent);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
