/**
 * Computer Use elevation checks (design §10.5.4, CU-SESSION-11/12).
 *
 * - At session start the supervisor refuses to run when AiFetchly itself is
 *   elevated (`host_elevated`): an elevated agent could drive administrator
 *   windows and the product does not support that.
 * - Before every dispatch, the integrity level of the target window's
 *   process is queried (cached per process id for the observation). A level
 *   above AiFetchly's returns `unsupported_target`/`elevated_window`.
 * - A failed query is treated as elevated (fail closed): UIPI-blocked
 *   SendInput gives no reliable failure signal, so unknown must mean no.
 */
import {
  ComputerUseError,
} from "@/entityTypes/computerUseTypes";

/** Windows integrity levels, ordered low → system; unknown fails closed. */
export type ProcessIntegrityLevel = "low" | "medium" | "high" | "system" | "unknown";

const INTEGRITY_ORDER: Record<Exclude<ProcessIntegrityLevel, "unknown">, number> = {
  low: 0,
  medium: 1,
  high: 2,
  system: 3,
};

/** True when the level is above the host's own level, or unknown. */
export function isAboveHostOrUnknown(
  level: ProcessIntegrityLevel,
  hostLevel: ProcessIntegrityLevel
): boolean {
  if (level === "unknown" || hostLevel === "unknown") return true;
  return INTEGRITY_ORDER[level] > INTEGRITY_ORDER[hostLevel];
}

/** Seam over the backend's process_integrity tool (Windows-MCP §6.1). */
export interface IntegrityQueryProvider {
  /** AiFetchly's own process integrity level. */
  hostIntegrity(): Promise<ProcessIntegrityLevel>;
  /** Integrity level of a window-owning process; throws when unqueryable. */
  processIntegrity(processId: number): Promise<ProcessIntegrityLevel>;
}

export class ComputerUseElevationService {
  private readonly provider: IntegrityQueryProvider;
  private cachedHost: ProcessIntegrityLevel | null = null;
  private readonly processCache = new Map<number, ProcessIntegrityLevel>();

  constructor(provider: IntegrityQueryProvider) {
    this.provider = provider;
  }

  /**
   * Resolve the host integrity (cached). Query failures map to `unknown`,
   * which fails closed everywhere it is compared.
   */
  async getHostIntegrity(): Promise<ProcessIntegrityLevel> {
    if (this.cachedHost) return this.cachedHost;
    try {
      const level = await this.provider.hostIntegrity();
      this.cachedHost = level === "unknown" ? "unknown" : level;
    } catch {
      this.cachedHost = "unknown";
    }
    return this.cachedHost;
  }

  /** Refuse sessions while AiFetchly runs elevated (CU-SESSION-12). */
  async assertHostNotElevated(): Promise<void> {
    const host = await this.getHostIntegrity();
    if (host === "high" || host === "system" || host === "unknown") {
      throw new ComputerUseError(
        "host_elevated",
        host === "unknown"
          ? "Cannot verify AiFetchly's integrity level; Computer Use is unavailable"
          : "AiFetchly is running elevated; restart it normally to use Computer Use"
      );
    }
  }

  /**
   * Check a target process against the host level. Cached per process id
   * for the current observation cycle; `clearProcessCache` is called on
   * re-observation. Throws the typed rejection when elevated/unknown.
   */
  async assertTargetNotElevated(processId: number): Promise<void> {
    const host = await this.getHostIntegrity();
    const level = await this.resolveProcessIntegrity(processId);
    if (isAboveHostOrUnknown(level, host)) {
      throw new ComputerUseError(
        "elevated_window",
        level === "unknown"
          ? "Target window integrity could not be verified"
          : "Target window runs at a higher integrity level than AiFetchly"
      );
    }
  }

  /** Boolean form for the safety pre-check verdict. */
  async isTargetElevatedOrUnknown(processId: number): Promise<boolean> {
    const host = await this.getHostIntegrity();
    const level = await this.resolveProcessIntegrity(processId);
    return isAboveHostOrUnknown(level, host);
  }

  private async resolveProcessIntegrity(
    processId: number
  ): Promise<ProcessIntegrityLevel> {
    const cached = this.processCache.get(processId);
    if (cached) return cached;
    let level: ProcessIntegrityLevel;
    try {
      level = await this.provider.processIntegrity(processId);
    } catch {
      level = "unknown";
    }
    this.processCache.set(processId, level);
    return level;
  }

  /** Called on every new observation (design §10.5.4 per-observation cache). */
  clearProcessCache(): void {
    this.processCache.clear();
  }
}
