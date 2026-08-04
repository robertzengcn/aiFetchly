import baseConfigFactory from "./vite.utilityCode.config.mjs";

const CI_UNSAFE_UTILITY_TESTS = [
  "test/vitest/utilitycode/nativeModuleVersion.test.ts",
  "test/vitest/utilitycode/puppeteer.test.ts",
  "test/vitest/utilitycode/googleScrape.test.ts",
  "test/vitest/utilitycode/searchdata.test.ts",
  "test/vitest/utilitycode/taskrundb.test.ts",
  "test/vitest/utilitycode/socialtaskrun.test.ts",
  "test/vitest/utilitycode/ObserveExecuteLoop.test.ts",
  "test/vitest/utilitycode/complianceNouns.test.ts",
  "test/vitest/utilitycode/layoutChatDock.test.ts",
  "test/vitest/utilitycode/plan-mode-registry-prompt.test.ts",
  "test/vitest/utilitycode/PageStateCapture.test.ts",
  "test/vitest/utilitycode/makefileback.test.ts",
  "test/vitest/utilitycode/hooks/HookExecutionWorker.test.ts",
  "test/vitest/utilitycode/fieldCipher.test.ts",
  "test/vitest/utilitycode/EmailReceiveConnectionConfig.test.ts",
  "test/vitest/utilitycode/pluginImportService.test.ts",
  "test/vitest/utilitycode/pluginDiagnosticsService.test.ts",
  "test/vitest/utilitycode/pluginLoaderService.test.ts",
  "test/vitest/utilitycode/pluginMarketplaceService.test.ts",
  "test/vitest/utilitycode/pluginInstallService.test.ts",
  "test/vitest/utilitycode/skillImportService.test.ts",
  "test/vitest/utilitycode/skillPermissionService.test.ts",
  "test/vitest/utilitycode/skillsRegistry.test.ts",
  "test/vitest/utilitycode/skillExecutor.test.ts",
  "test/vitest/utilitycode/userPluginAutoInstallService.test.ts",
  "test/vitest/utilitycode/installPipelineProvenance.test.ts",
];

export default (context) => {
  const baseConfig = baseConfigFactory(context);

  return {
    ...baseConfig,
    test: {
      ...baseConfig.test,
      exclude: [
        ...(baseConfig.test?.exclude ?? []),
        ...CI_UNSAFE_UTILITY_TESTS,
      ],
    },
  };
};
