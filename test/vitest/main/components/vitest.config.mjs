/// <reference types="vitest" />
//
// Dedicated Vitest config for the component-test subtree.
//
// Why this file exists:
//   The root `vite.main.config.mjs` keeps `test.environment` unset (defaults to
//   'node') because setting it to 'happy-dom' globally breaks sibling tests
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
// Invocation:
//   yarn vitest --config test/vitest/main/components/vitest.config.mjs run \
//       test/vitest/main/components/AiChatV2Message.toolProgress.test.ts
//
import { defineConfig, mergeConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import baseConfig from "../../../../vite.main.config.mjs";

// baseConfig is a function (mode) => UserConfig in this project. Invoke it with
// the test mode to obtain the resolved UserConfig, then merge our overrides.
const resolvedBase =
  typeof baseConfig === "function" ? baseConfig({ mode: "test" }) : baseConfig;

export default mergeConfig(
  resolvedBase,
  defineConfig({
    // The root config does NOT include @vitejs/plugin-vue because the main
    // process bundle has no .vue files. Component tests import .vue files,
    // so the plugin is required here for Vite to transform them.
    plugins: [vue()],
    test: {
      environment: "happy-dom",
      include: ["test/vitest/main/components/**/*.test.ts"],
    },
  })
);
