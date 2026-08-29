/**
 * SkillDependencyOrchestrator — maps repository dependency proposals onto
 * the typed system dependency catalog with multi-probe verification
 * (design §12, PRD §18, TODO 4).
 *
 * The SHIPPED catalog (src/config/dependency-catalog.json — the same file
 * SystemDependencyModule loads) is the primary source: its probe binary,
 * description, and platform install candidates feed every plan item it
 * covers. A small fallback table adds entries the catalog does not ship
 * (git, python, node) and the multi-probe rules the catalog format cannot
 * express (video-use's ffmpeg is satisfied only when BOTH ffmpeg and
 * ffprobe probes pass — PRD §18.3).
 *
 * Repository prose may SUGGEST an installation command, but only cataloged
 * dependencies can use the typed installer; everything else stays a
 * user-approved repository command.
 */

import type {
  DependencyPlanItem,
  VerificationProbe,
} from "@/entityTypes/skillInstallationTypes";
import {
  buildChildEnvironment,
  getPlatformProcessProvider,
} from "@/service/process";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";
import catalogJson from "@/config/dependency-catalog.json";

/**
 * Fallback entries for binaries the shipped catalog does not cover, plus the
 * multi-probe companions (ffprobe rides with ffmpeg). The catalog supplies
 * everything it covers; this table only fills the remainder.
 */
interface KnownBinary {
  readonly name: string;
  readonly probes: readonly VerificationProbe[];
  readonly installHint: string;
}

const FALLBACK_BINARIES: readonly KnownBinary[] = [
  {
    name: "ffmpeg",
    probes: [
      {
        command: "ffmpeg -version",
        expectedPattern: "ffmpeg version",
        description: "ffmpeg binary",
      },
      {
        command: "ffprobe -version",
        expectedPattern: "ffprobe version",
        description: "ffprobe binary",
      },
    ],
    installHint:
      "ffmpeg (includes ffprobe) via brew/apt/winget or a managed binary",
  },
  {
    name: "git",
    probes: [
      {
        command: "git --version",
        expectedPattern: "git version",
        description: "git binary",
      },
    ],
    installHint: "git",
  },
  {
    name: "python",
    probes: [
      {
        command: "python3 --version",
        expectedPattern: "Python",
        description: "python3 interpreter",
      },
    ],
    installHint: "python3",
  },
  {
    name: "node",
    probes: [
      {
        command: "node --version",
        expectedPattern: "v",
        description: "node runtime",
      },
    ],
    installHint: "node",
  },
];

/** Proposals: text mentions of binaries inside install instructions. */
const PROPOSAL_RE = /\b(ffmpeg|ffprobe|git|python3?|node|npm)\b/g;

/** Process-wide catalog instance (same source file the module loads). */
let catalogInstance: SystemDependencyCatalog | null = null;
function getCatalog(): SystemDependencyCatalog {
  if (!catalogInstance) {
    catalogInstance = new SystemDependencyCatalog(
      loadCatalogFromConfig(catalogJson)
    );
  }
  return catalogInstance;
}

/** Test seam: inject a catalog built from different raw config. */
export function setDependencyCatalogForTests(
  catalog: SystemDependencyCatalog | null
): void {
  catalogInstance = catalog;
}

/**
 * Catalog-backed plan item for a dependency name: probe binary, description,
 * and the CURRENT platform's install candidate (manager + package) come from
 * the shipped catalog; the fallback table fills what the catalog lacks.
 */
function planItemFor(
  name: string,
  extraProbes: readonly VerificationProbe[] = []
): DependencyPlanItem | null {
  const entry = getCatalog().getById(name);
  const platform = process.platform as "darwin" | "linux" | "win32";
  // Exact probe COMMANDS come from the fallback table when it has them —
  // CLI flag syntax is tool-specific (ffmpeg documents single-dash
  // `-version`; `--version` exits non-zero). The catalog supplies the
  // identity (probe binary), description, and platform install candidate.
  const exact = FALLBACK_BINARIES.find((b) => b.name === name);
  if (entry) {
    const candidate = getCatalog().getPlatformCandidate(name, platform);
    const installMethod = candidate
      ? `${candidate.manager}: ${candidate.package} (${entry.description})`
      : entry.description;
    return {
      id: `dep:${name}`,
      kind: "system-binary",
      name,
      currentStatus: "unknown",
      installMethod,
      requiresElevation: name !== "node",
      approvalRisk: "low",
      probes: exact
        ? exact.probes
        : [
            {
              command: `${entry.probe} --version`,
              description: `${entry.probe} binary`,
            },
            ...extraProbes,
          ],
    };
  }
  const fallback = FALLBACK_BINARIES.find((b) => b.name === name);
  if (!fallback) return null;
  return {
    id: `dep:${name}`,
    kind: "system-binary",
    name,
    currentStatus: "unknown",
    installMethod: fallback.installHint,
    requiresElevation: name !== "node",
    approvalRisk: "low",
    probes: fallback.probes,
  };
}

/**
 * Extract typed dependency plan items from instruction text. Pure function —
 * detection (running probes) is separate and fallible-tolerant.
 */
export function detectDependencyProposals(
  instructionTexts: readonly string[]
): DependencyPlanItem[] {
  const text = instructionTexts.join("\n");
  const wanted = new Set<string>();
  for (const match of text.matchAll(PROPOSAL_RE)) {
    const raw = match[1].toLowerCase();
    if (raw === "ffprobe") {
      wanted.add("ffmpeg"); // ffprobe ships with ffmpeg
    } else if (raw === "python" || raw === "npm") {
      wanted.add(raw === "python" ? "python" : "node");
    } else {
      wanted.add(raw);
    }
  }

  const items: DependencyPlanItem[] = [];
  for (const name of wanted) {
    // The catalog cannot express 'ffprobe must also pass' — attach it as an
    // extra probe when the entry is ffmpeg (PRD §18.3 multi-probe rule).
    const extra =
      name === "ffmpeg"
        ? [
            {
              command: "ffprobe -version",
              expectedPattern: "ffprobe version",
              description: "ffprobe binary",
            },
          ]
        : [];
    const item = planItemFor(name, extra);
    if (item) items.push(item);
  }
  return items;
}

export interface ProbeOutcome {
  readonly dependencyId: string;
  readonly passed: boolean;
  readonly evidence: string;
}

/**
 * Run a dependency's probes through the platform provider. A dependency is
 * satisfied only when EVERY declared probe passes (multi-probe rule).
 */
export async function probeDependency(
  item: DependencyPlanItem,
  cwd: string
): Promise<ProbeOutcome> {
  const provider = getPlatformProcessProvider();
  let allPassed = true;
  const evidence: string[] = [];
  for (const probe of item.probes) {
    const parts = probe.command.split(/\s+/);
    const result = await provider.execute({
      executable: parts[0],
      args: parts.slice(1),
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 15_000,
      outputLimitBytes: 64 * 1024,
      expectOutput: true,
    });
    const ok =
      result.exitCode === 0 &&
      result.stdout.trim().length > 0 &&
      (!probe.expectedPattern ||
        result.stdout
          .toLowerCase()
          .includes(probe.expectedPattern.toLowerCase()));
    if (!ok) allPassed = false;
    evidence.push(
      `${probe.description}: ${ok ? "ok" : "missing"}${
        result.diagnosticCode ? ` (${result.diagnosticCode})` : ""
      }`
    );
  }
  return {
    dependencyId: item.id,
    passed: allPassed,
    evidence: evidence.join("; "),
  };
}

/** Detect every item in a plan and return updated statuses. */
export async function detectAll(
  items: readonly DependencyPlanItem[],
  cwd: string
): Promise<readonly DependencyPlanItem[]> {
  return Promise.all(
    items.map(async (item): Promise<DependencyPlanItem> => {
      const outcome = await probeDependency(item, cwd);
      return {
        ...item,
        currentStatus: outcome.passed ? "satisfied" : "missing",
      };
    })
  );
}
