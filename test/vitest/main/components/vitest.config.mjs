/// <reference types="vitest" />
//
// Dedicated Vitest config for the component-test subtree.
//
// Why this file exists:
//   The root `vite.main.config.mjs` keeps `test.environment` unset (defaults to
//   'node') because setting it to 'happy-dom'' globally breaks sibling tests
//   such as `AIChatQueryLoopAsyncPoll.test.ts` — happy-dom interferes with
//   resolution of Node builtins like 'fs'.
//
//   Component tests here mount Vue components via @vue/test-utils, which
//   requires a DOM. This config opts ONLY this subtree into 'happy-dom' so
//   both worlds coexist:
//     - `yarn vitest --config vite.main.config.mjs run <node-test>`
//         → node environment (default)
//     - `yarn vitest --config test/vitest/main/components/vitest.config.mjs run`
//         → happy-dom environment (component tests)
//
//   This config is intentionally standalone (does NOT mergeConfig with the
//   root) because the root's `include` negation pattern (added to keep the
//   root suite from trying to parse .vue files) would otherwise be inherited
//   and exclude the component tests here too.
//
// Invocation:
//   yarn vitest --config test/vitest/main/components/vitest.config.mjs run \
//       test/vitest/main/components/AiChatV2Message.toolProgress.test.ts
//
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import * as path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../../../src"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["test/vitest/main/components/**/*.test.ts"],
  },
});
