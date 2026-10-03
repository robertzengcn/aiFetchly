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

/** Proposals: text mentions of binaries inside install instructions.
 * Case-insensitive (audit R9): "Python 3.10+" is normal English casing. */
const PROPOSAL_RE = /\b(ffmpeg|ffprobe|git|python3?|node|npm)\b/gi;

/**
 * Audit R9 (PRD §18.2): version constraints named in instructions —
 * "Python 3.10+", "python >= 3.10", "Node 18+", "node >= 18", "ffmpeg 4+".
 * Captured per dependency name and enforced against the DETECTED version
 * (an old-but-present binary becomes `incompatible`, not `satisfied`).
 */
const VERSION_CONSTRAINT_RE =
  /\b(python3?|node|npm|ffmpeg|git)\s*(?:>=|≥)?\s*v?(\d+(?:\.\d+)*)(?:\+|\b)/gi;

/** Extract every named version constraint from instruction text. */
export function extractVersionConstraints(
  instructionTexts: readonly string[]
): ReadonlyMap<string, string> {
  const text = instructionTexts.join("\n");
  const out = new Map<string, string>();
  for (const match of text.matchAll(VERSION_CONSTRAINT_RE)) {
    const rawName = match[1].toLowerCase();
    const name =
      rawName === "python3" || rawName === "npm"
        ? rawName === "npm"
          ? "node"
          : "python"
        : rawName;
    if (!out.has(name)) {
      out.set(name, `>=${match[2]}`);
    }
  }
  return out;
}

/** Parse a dotted version out of probe output ("Python 3.11.4" → 3.11.4). */
export function parseDetectedVersion(output: string): string | undefined {
  const match = output.match(/(\d+(?:\.\d+)+)/);
  return match?.[1];
}

/** Numeric compare of dotted versions; missing segments count as 0. */
export function satisfiesVersion(
  detected: string,
  constraint: string
): boolean {
  const constraintMatch = constraint.match(
    /(>=)?\s*(\d+(?:\.\d+)*)/
  );
  if (!constraintMatch) return true;
  const required = constraintMatch[2].split(".").map((n) => Number(n));
  const actual = detected.split(".").map((n) => Number(n));
  const len = Math.max(required.length, actual.length);
  for (let i = 0; i < len; i += 1) {
    const r = required[i] ?? 0;
    const a = actual[i] ?? 0;
    if (a > r) return true;
    if (a < r) return false;
  }
  return true;
}

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
      shared: true,
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
    shared: true,
    probes: fallback.probes,
  };
}

/**
 * Extract typed dependency plan items from instruction text. Pure function —
 * detection (running probes) is separate and fallible-tolerant.
 *
 * Audit R9 (PRD §18.1): beyond system binaries, the plan CLASSIFIES
 * language-environment requirements (staged lockfiles/manifests), MCP
 * servers, and model artifacts as visible items of their own kind instead
 * of silently dropping them, and carries named version constraints
 * (PRD §18.2) onto matching binaries.
 */
export function detectDependencyProposals(
  instructionTexts: readonly string[],
  stagedFiles?: readonly string[]
): DependencyPlanItem[] {
  const text = instructionTexts.join("\n");
  const wanted = new Set<string>();
  for (const match of text.matchAll(PROPOSAL_RE)) {
    const raw = match[1].toLowerCase();
    if (raw === "ffprobe") {
      wanted.add("ffmpeg"); // ffprobe ships with ffmpeg
    } else if (raw === "python" || raw === "python3" || raw === "npm") {
      // The catalog/fallback keys BOTH variants as 'python' (audit finding
      // 12: a bare `python3 --version` instruction produced NO dependency
      // because 'python3' matched no table entry).
      wanted.add(raw === "npm" ? "node" : "python");
    } else {
      wanted.add(raw);
    }
  }

  const constraints = extractVersionConstraints(instructionTexts);

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
    if (!item) continue;
    const requiredVersion = constraints.get(name);
    items.push(
      requiredVersion
        ? {
            ...item,
            requiredVersion,
            // A version-constrained binary is no longer low-risk: an old
            // version must surface for the user, not pass silently.
            approvalRisk: "medium",
          }
        : item
    );
  }
  items.push(...environmentProposals(stagedFiles));
  items.push(...classificationProposals(text));
  return items;
}

/**
 * Audit R9 (design §12 / PRD §18.1): staged language-environment manifests
 * (requirements.txt / pyproject.toml / package.json) produce their own
 * skill-SPECIFIC environment plan items — a `pip install`/`npm install`
 * prose mention alone says nothing about an isolated environment.
 */
function environmentProposals(
  stagedFiles?: readonly string[]
): DependencyPlanItem[] {
  if (!stagedFiles || stagedFiles.length === 0) return [];
  const files = new Set(stagedFiles.map((f) => f.toLowerCase()));
  const out: DependencyPlanItem[] = [];
  if (
    files.has("requirements.txt") ||
    files.has("pyproject.toml") ||
    files.has("environment.yml")
  ) {
    out.push({
      id: "dep:python-environment",
      kind: "python-environment",
      name: "python-environment",
      currentStatus: "unknown",
      installMethod:
        "Managed Python environment under skill-environments/<installation-id>/ (hash-pinned)",
      requiresElevation: false,
      approvalRisk: "medium",
      shared: false,
      probes: [
        {
          command: "python3 --version",
          expectedPattern: "Python",
          description: "python interpreter for the managed environment",
        },
      ],
    });
  }
  if (files.has("package.json")) {
    out.push({
      id: "dep:node-environment",
      kind: "node-environment",
      name: "node-environment",
      currentStatus: "unknown",
      installMethod:
        "Managed Node environment under skill-environments/<installation-id>/ (lifecycle scripts are a separate high-risk item)",
      requiresElevation: false,
      approvalRisk: "medium",
      shared: false,
      probes: [
        {
          command: "node --version",
          expectedPattern: "v",
          description: "node runtime for the managed environment",
        },
      ],
    });
  }
  return out;
}

/**
 * Audit R9 (PRD §18.1): MCP-server and model-artifact requirements named in
 * the instructions surface as classification items (no probes — they are
 * downloads/registrations the typed installer mediates, not system probes).
 */
function classificationProposals(text: string): DependencyPlanItem[] {
  const out: DependencyPlanItem[] = [];
  if (/\bmcp\b|\bmodelcontextprotocol\b/i.test(text)) {
    out.push({
      id: "dep:mcp-server",
      kind: "mcp-server",
      name: "mcp-server",
      currentStatus: "unknown",
      installMethod:
        "MCP server registration mediated by the typed installer (never a raw shell install)",
      requiresElevation: false,
      approvalRisk: "medium",
      shared: false,
      probes: [],
    });
  }
  if (
    /\b(?:gguf|ggml|huggingface(?:\.co)?|model file|download the model)\b/i.test(
      text
    )
  ) {
    out.push({
      id: "dep:model-artifact",
      kind: "model-artifact",
      name: "model-artifact",
      currentStatus: "unknown",
      installMethod:
        "Model artifact download mediated by the typed installer (size shown when known)",
      requiresElevation: false,
      approvalRisk: "medium",
      shared: false,
      probes: [],
    });
  }
  return out;
}

export interface ProbeOutcome {
  readonly dependencyId: string;
  readonly passed: boolean;
  readonly evidence: string;
  /** Audit R9 (PRD §18.2): the detected version parsed from probe output. */
  readonly detectedVersion?: string;
  /** Audit R9 (PRD §18.3): the resolved executable path (which/where). */
  readonly resolvedPath?: string;
}

/**
 * Run a dependency's probes through the platform provider. A dependency is
 * satisfied only when EVERY declared probe passes (multi-probe rule).
 * Audit R9: the first passing probe's output yields the DETECTED VERSION,
 * and a `which`/`where` lookup resolves the binary's path (PRD §18.2-18.3).
 */
export async function probeDependency(
  item: DependencyPlanItem,
  cwd: string
): Promise<ProbeOutcome> {
  const provider = getPlatformProcessProvider();
  let allPassed = true;
  let detectedVersion: string | undefined;
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
    if (ok && detectedVersion === undefined) {
      detectedVersion = parseDetectedVersion(result.stdout);
    }
    evidence.push(
      `${probe.description}: ${ok ? "ok" : "missing"}${
        result.diagnosticCode ? ` (${result.diagnosticCode})` : ""
      }${detectedVersion && ok ? ` [${detectedVersion}]` : ""}`
    );
  }
  return {
    dependencyId: item.id,
    passed: allPassed,
    evidence: evidence.join("; "),
    ...(detectedVersion !== undefined ? { detectedVersion } : {}),
    ...(allPassed
      ? { resolvedPath: await resolveBinaryPath(item, cwd) }
      : {}),
  };
}

/**
 * Resolve the on-disk path of the item's primary binary through the
 * platform provider (`which` on POSIX, `where` on Windows). Best-effort:
 * an unresolvable path never fails detection.
 */
async function resolveBinaryPath(
  item: DependencyPlanItem,
  cwd: string
): Promise<string | undefined> {
  if (item.probes.length === 0) return undefined;
  const binary = item.probes[0].command.split(/\s+/)[0];
  const provider = getPlatformProcessProvider();
  try {
    const result = await provider.execute({
      executable: process.platform === "win32" ? "where" : "which",
      args: [binary],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 8 * 1024,
      expectOutput: true,
    });
    if (result.exitCode !== 0) return undefined;
    const firstLine = result.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return firstLine || undefined;
  } catch {
    return undefined;
  }
}

/** Detect every item in a plan and return updated statuses. */
export async function detectAll(
  items: readonly DependencyPlanItem[],
  cwd: string
): Promise<readonly DependencyPlanItem[]> {
  return Promise.all(
    items.map(async (item): Promise<DependencyPlanItem> => {
      // Classification items (MCP server / model artifact) carry no probes:
      // their status stays `unknown` — a visible decision, not a fake pass.
      if (item.probes.length === 0) {
        return { ...item, currentStatus: "unknown" };
      }
      const outcome = await probeDependency(item, cwd);
      // Audit R9 (PRD §18.2): a probe that PASSES with an OLD version is
      // `incompatible`, not `satisfied` — the constraint is enforced.
      const status = !outcome.passed
        ? "missing"
        : item.requiredVersion &&
          outcome.detectedVersion &&
          !satisfiesVersion(outcome.detectedVersion, item.requiredVersion)
          ? "incompatible"
          : "satisfied";
      return {
        ...item,
        currentStatus: status,
        // Audit finding 12: keep the probe evidence (version output /
        // diagnostic codes) instead of collapsing to the status word.
        detectionEvidence: outcome.evidence,
        ...(outcome.detectedVersion !== undefined
          ? { detectedVersion: outcome.detectedVersion }
          : {}),
        ...(outcome.resolvedPath !== undefined
          ? { resolvedPath: outcome.resolvedPath }
          : {}),
      };
    })
  );
}
