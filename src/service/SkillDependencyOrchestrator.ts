/**
 * SkillDependencyOrchestrator — maps repository dependency proposals onto
 * the typed system dependency catalog with multi-probe verification
 * (design §12, PRD §18).
 *
 * Repository prose may SUGGEST an installation command, but only cataloged
 * dependencies can use the typed installer; everything else stays a
 * user-approved repository command. video-use's ffmpeg requirement is
 * satisfied only when BOTH ffmpeg and ffprobe probes pass (PRD §18.3).
 */

import type {
  DependencyPlanItem,
  VerificationProbe,
} from "@/entityTypes/skillInstallationTypes";
import {
  buildChildEnvironment,
  getPlatformProcessProvider,
} from "@/service/process";

/**
 * Known system binaries commonly required by agent skills. Catalog-backed
 * install flows through SystemDependencyModule; unknown packages never do.
 */
interface KnownBinary {
  readonly name: string;
  readonly probes: readonly VerificationProbe[];
  readonly installHint: string;
}

const KNOWN_BINARIES: readonly KnownBinary[] = [
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
  for (const binary of KNOWN_BINARIES) {
    if (!wanted.has(binary.name)) continue;
    items.push({
      id: `dep:${binary.name}`,
      kind: "system-binary",
      name: binary.name,
      currentStatus: "unknown",
      installMethod: binary.installHint,
      requiresElevation: binary.name !== "node",
      approvalRisk: "low",
      probes: binary.probes,
    });
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
