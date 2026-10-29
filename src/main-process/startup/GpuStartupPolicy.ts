export type GpuStartupDecisionReason =
  | "explicit-flag"
  | "wsl"
  | "indirect-gl"
  | "dev"
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
  // Platform-specific triggers keep their precise reasons on Linux.
  if (platform === "linux") {
    if (
      Boolean(environment.WSL_DISTRO_NAME) ||
      Boolean(environment.WSL_INTEROP)
    ) {
      return { disableGpu: true, reason: "wsl" };
    }
    if (isDevelopment && environment.LIBGL_ALWAYS_INDIRECT === "1") {
      return { disableGpu: true, reason: "indirect-gl" };
    }
  }
  // Dev runs disable GPU acceleration on every platform: dev machines are
  // heterogeneous (laptops with hybrid GPUs, WSLg, VMs), and GPU-compositing
  // glitches there cost more debugging time than software rendering costs
  // performance. Packaged builds keep acceleration on non-trigger platforms.
  if (isDevelopment) {
    return { disableGpu: true, reason: "dev" };
  }
  return { disableGpu: false, reason: "none" };
}
