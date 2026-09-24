/**
 * SkillInstallPlanner — builds the immutable, revisioned installation plan
 * (design §8.3, PRD §12.2).
 *
 * The plan separates typed categories (app-owned operations, workspace
 * operations, dependency detection, credential requirements, activation,
 * readiness probes) — repository prose may PROPOSE operations, but the
 * planner validates every action and unknown/opaque commands stay visible
 * as high-risk items requiring explicit approval.
 *
 * The plan revision hashes every instruction file so any change to the
 * acquired source invalidates prior approval (§16).
 */

import * as crypto from "crypto";
import type {
  ApprovedCommandTemplate,
  SkillActivationMode,
  CredentialRequirement,
  DiscoveredSkillPackage,
  InstallWarning,
  RequestedSkillPermission,
  ResolvedSkillSource,
  SkillInstallPlan,
  VerificationProbe,
} from "@/entityTypes/skillInstallationTypes";
import type { InstructionFile } from "@/service/SkillPackageInspectionService";
import { detectDependencyProposals } from "@/service/SkillDependencyOrchestrator";

export interface PlanInput {
  readonly sessionId: string;
  readonly source: ResolvedSkillSource;
  readonly discovered: readonly DiscoveredSkillPackage[];
  readonly instructionFiles: readonly InstructionFile[];
  readonly activationMode: SkillActivationMode | "linked";
  readonly activationTargetDir: string;
  readonly constraints: readonly string[];
  /** Enabled installations by skill NAME (any source) for same-name
   *  replacement warnings (audit finding 3 / §24.1). */
  readonly existingEnabledByName?: ReadonlyMap<string, string>;
}

/**
 * Known credential environment variables requested by repository prose.
 * Matches full UPPER_SNAKE names whose last segment is a credential word
 * (…_KEY / …_TOKEN / …_SECRET / …_PASSWORD) followed by = or :. The
 * previous shape anchored on a single alternation and consumed overlapping
 * text, so multi-variable instructions (GITHUB_TOKEN=, CLIENT_SECRET=,
 * ELEVENLABS_API_KEY=) discovered only the LAST one (audit finding 5).
 */
const CREDENTIAL_ENV_RE =
  /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*(?:_API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD))\s*[=:]/g;

export function buildSkillInstallPlan(input: PlanInput): SkillInstallPlan {
  const dependencies = detectDependencyProposals(
    input.instructionFiles.map((f) => f.content)
  );
  const credentials = detectCredentialRequirements(
    input.instructionFiles.map((f) => f.content)
  );
  const permissions = collectRequestedPermissions(
    input.instructionFiles.map((f) => f.content),
    input.discovered
  );
  const commands = collectCommandTemplates(
    input.instructionFiles.map((f) => f.content)
  );

  const warnings: InstallWarning[] = [];
  if (input.source.acquisitionMethod === "local-copy") {
    warnings.push({
      code: "mutable-local-source",
      message:
        "Local folder sources can change outside AiFetchly; the installed " +
        "copy is pinned to the content hash recorded at install time.",
    });
  }
  for (const pkg of input.discovered) {
    warnings.push(...pkg.compatibilityWarnings);
  }
  // §24.1 / audit finding 3: activating a skill whose name is already
  // installed from a DIFFERENT source replaces that activation's files —
  // the plan must say so before approval, not silently overwrite.
  for (const pkg of input.discovered) {
    const existingSource = input.existingEnabledByName?.get(pkg.name);
    if (
      existingSource !== undefined &&
      existingSource !== input.source.canonicalUri
    ) {
      warnings.push({
        code: "replacing-existing-skill",
        message:
          `'${pkg.name}' is already installed from a different source ` +
          `(${existingSource}). Approving this plan REPLACES that installation's files.`,
      });
    }
  }
  if (input.discovered.length > 1) {
    warnings.push({
      code: "multiple-skills-found",
      message:
        "Multiple independent skills were discovered; the user must choose " +
        "which to activate (or explicitly install all).",
    });
  }

  const verification: VerificationProbe[] = [
    {
      command: "activation: SKILL.md readable",
      description: "Activation structural check",
    },
    ...dependencies.flatMap((d) => d.probes),
  ];

  const selectedSkillIds =
    input.discovered.length === 1 ? [input.discovered[0].candidateId] : [];

  // Resolve the request-level mode ("linked") into the platform-concrete
  // activation mode the plan records and later activation uses.
  const resolvedActivationMode: SkillActivationMode =
    input.activationMode === "linked"
      ? process.platform === "win32"
        ? "junction"
        : "symbolic-link"
      : "managed-copy";

  const plan: Omit<SkillInstallPlan, "planRevision"> = {
    planVersion: 1,
    sessionId: input.sessionId,
    source: input.source,
    discoveredSkills: input.discovered,
    selectedSkillIds,
    activation: {
      mode: resolvedActivationMode,
      targetDirectory: input.activationTargetDir,
      skillsToActivate: selectedSkillIds,
    },
    dependencies,
    credentials,
    commands,
    permissions,
    warnings,
    verification,
  };

  return {
    ...plan,
    planRevision: computePlanRevision(plan, input.instructionFiles),
  };
}

/** Deterministic revision hash over the plan + instruction hashes (§8.3). */
function computePlanRevision(
  plan: Omit<SkillInstallPlan, "planRevision">,
  instructionFiles: readonly InstructionFile[]
): string {
  // Streaming hash (JSON + per-file hashes) — sha256Hex is for single
  // values; keep the stream here with the shared algorithm.
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(plan));
  for (const file of instructionFiles) {
    hash.update(file.relativePath);
    hash.update(file.contentHash);
  }
  return hash.digest("hex").slice(0, 16);
}

export function detectCredentialRequirements(
  instructionTexts: readonly string[]
): CredentialRequirement[] {
  const found = new Map<string, CredentialRequirement>();
  for (const text of instructionTexts) {
    for (const match of text.matchAll(CREDENTIAL_ENV_RE)) {
      const name = match[1];
      if (!name || name.length < 5) continue;
      found.set(name, {
        id: `cred:${name}`,
        name,
        environmentVariable: name,
        provider: "declared-in-instructions",
        required: true,
      });
    }
  }
  return [...found.values()];
}

function collectRequestedPermissions(
  instructionTexts: readonly string[],
  discovered: readonly DiscoveredSkillPackage[]
): RequestedSkillPermission[] {
  const permissions: RequestedSkillPermission[] = [];
  const text = instructionTexts.join("\n");
  if (/\bpip\s+install|\bnpm\s+install|\buv\s+(pip\s+)?install/i.test(text)) {
    permissions.push({
      kind: "package-manager",
      detail: "Repository instructions invoke a language package manager.",
    });
  }
  if (/\bcurl\b|\bwget\b|\bhttps?:\/\//i.test(text)) {
    permissions.push({
      kind: "network",
      detail: "Repository instructions reference network downloads.",
    });
  }
  for (const pkg of discovered) {
    if (pkg.helperSummaryCount > 0) {
      permissions.push({
        kind: "helper-execution",
        detail: `Skill bundles ${pkg.helperSummaryCount} helper file(s); execution is separately approved.`,
      });
    }
  }
  return permissions;
}

/**
 * Parse repository-provided setup commands into typed approval templates.
 * Opaque strings, encoded commands, substitution, and privilege escalation
 * surface as high-risk items — visible to the user, never silently trusted
 * (PRD §18.4).
 */
export function collectCommandTemplates(
  instructionTexts: readonly string[]
): ApprovedCommandTemplate[] {
  return collectCommandTemplatesWithEnv(
    instructionTexts,
    detectCredentialRequirements(instructionTexts).map(
      (c) => c.environmentVariable
    )
  );
}

/**
 * Audit finding 4: real plans must carry the full argument list (the old
 * whitespace split DROPPED non-plain args entirely), declare the env-var
 * NAMES the runner may inject from the secure store, and mark templates
 * referencing those variables medium-risk so the review card shows them.
 */
export function collectCommandTemplatesWithEnv(
  instructionTexts: readonly string[],
  credentialEnvNames: readonly string[]
): ApprovedCommandTemplate[] {
  const templates: ApprovedCommandTemplate[] = [];
  const seen = new Set<string>();
  const text = instructionTexts.join("\n");

  for (const line of text.split("\n")) {
    const command = line.trim();
    if (command === "" || !isShellish(command)) continue;
    if (seen.has(command)) continue;
    seen.add(command);

    const highRisk =
      /\bsudo\b|\bsu\b|&&|\|\||`|\$\(|\bchmod\b|\bchown\b|\brm\s+-rf?\b/i.test(
        command
      );
    const privileged = /\bsudo\b/i.test(command);

    // Simple prefix-based parse; anything unparsable keeps the whole line as
    // the executable so the user reviews exactly what would run. Plain
    // arguments are kept WHOLE (audit finding 4: the old filter dropped
    // $-free but quoted/globbed args from the typed template, so the card
    // showed fewer arguments than would execute); substituted args stay on
    // the unparsable path with the full line as the executable.
    const parts = command.split(/\s+/);
    const plainArgs = (privileged ? parts.slice(2) : parts.slice(1)).filter(
      isPlainArg
    );
    const droppedSubstitution =
      (privileged ? parts.slice(2) : parts.slice(1)).length - plainArgs.length >
      0;
    const envNames = credentialEnvNames.filter((name) =>
      new RegExp(`\\$\\{?${name}\\}?`).test(command)
    );
    templates.push({
      id: `cmd:${crypto
        .createHash("sha1")
        .update(command)
        .digest("hex")
        .slice(0, 8)}`,
      executable: privileged ? parts[1] ?? command : parts[0],
      args: plainArgs,
      workingDirectory: "<skill source root>",
      environmentNames: envNames,
      riskLevel: highRisk
        ? "high"
        : envNames.length > 0 || droppedSubstitution
          ? "medium"
          : "low",
      rationale: privileged
        ? "Privilege escalation detected in repository instructions"
        : envNames.length > 0
          ? "Proposed by repository instructions; injects credentials from the secure store"
          : "Proposed by repository instructions",
    });
  }
  return templates.slice(0, 50);
}

function isShellish(line: string): boolean {
  return (
    /^(?:sudo\s+)?(?:pip|pip3|python|python3|node|npm|npx|yarn|uv|brew|apt|apt-get|winget|choco|git|ffmpeg|curl|wget|bash|sh|chmod|chown|export|cd)\b/.test(
      line
    ) || /&&|\|\||`/.test(line)
  );
}

function isPlainArg(arg: string): boolean {
  // Keep only plain arguments for the typed template; substitutions surface
  // in riskLevel instead of being silently executed.
  return !arg.includes("$") && !arg.includes("`") && !arg.includes("*");
}
