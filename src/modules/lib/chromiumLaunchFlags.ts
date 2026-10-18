export function withLinuxChromiumStabilityFlags(
  args: ReadonlyArray<string>,
  platform: NodeJS.Platform
): string[] {
  const merged = [...args];
  if (platform !== "linux") {
    return merged;
  }
  const stabilityFlags = ["--no-sandbox", "--disable-gpu"] as const;
  for (const flag of stabilityFlags) {
    if (!merged.includes(flag)) {
      merged.push(flag);
    }
  }
  return merged;
}
