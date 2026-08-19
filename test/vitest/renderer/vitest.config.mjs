/// <reference types="vitest" />
//
// Renderer-only UI test config (TODO 2 / PRD §5.1).
//
// These tests exercise Vue/renderer code with a typed `window.api` fake and
// happy-dom — NO Electron is launched, NO IPC is mocked at the Electron level.
// Run: yarn vitest --config test/vitest/renderer/vitest.config.mjs run
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import * as path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../../src"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["test/vitest/renderer/**/*.test.ts"],
  },
});
