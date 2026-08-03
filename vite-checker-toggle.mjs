export function optionalChecker(createCheckerPlugin) {
  if (process.env.AIFETCHLY_SKIP_VITE_CHECKER === "1") {
    return [];
  }
  return [createCheckerPlugin()];
}
