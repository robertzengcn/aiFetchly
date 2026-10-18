export type GpuStartupDecisionReason =
  | "explicit-flag"
  | "wsl"
  | "indirect-gl"
  | "none";

export interface GpuStartupDecision {
  disableGpu: boolean;
  reason: GpuStartupDecisionReason;
}

export function resolveGpuStartupPolicy(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isDevelopment: boolean
): GpuStartupDecision {
  if (environment.AIFETCHLY_DISABLE_GPU === "1") {
    return { disableGpu: true, reason: "explicit-flag" };
  }
  if (platform !== "linux") {
    return { disableGpu: false, reason: "none" };
  }
  if (
    Boolean(environment.WSL_DISTRO_NAME) ||
    Boolean(environment.WSL_INTEROP)
  ) {
    return { disableGpu: true, reason: "wsl" };
  }
  if (isDevelopment && environment.LIBGL_ALWAYS_INDIRECT === "1") {
    return { disableGpu: true, reason: "indirect-gl" };
  }
  return { disableGpu: false, reason: "none" };
}
