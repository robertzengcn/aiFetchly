/**
 * SkillInstallIntentGuard — deterministic routing for high-confidence
 * explicit skill lifecycle requests (design §8.5, PRD §9.6-9.7, FR-01/FR-26).
 *
 * The guard returns `explicit` ONLY when the user combines a skill/plugin/
 * repository/package signal with a supported source, an installed-skill
 * identity, or an unmistakable lifecycle phrase. It must NOT claim ordinary
 * "install node dependencies", "clone my repository", or "configure ffmpeg
 * for this project" requests — those stay on normal tool policy.
 *
 * Provider-neutral: no Claude/Codex/OpenAI role names, no provider-specific
 * skill directories. Pure data — main-process safe.
 */

export type SkillRequestIntent =
  | "install-package"
  | "update-package"
  | "repair-package"
  | "configure-package"
  | "invoke-prompt-skill"
  | "execute-skill"
  | "manage-installation"
  | "unrelated";

export type SkillRoutingConfidence = "explicit" | "semantic" | "ambiguous";

export type SkillAllowedEntryPoint =
  | "skill_install_prepare"
  | "skill_install_session_action"
  | "use_skill"
  | "executable-skill-tool"
  | "normal-tool-policy";

export interface SkillRoutingDecision {
  readonly policyVersion: 1;
  readonly intent: SkillRequestIntent;
  readonly confidence: SkillRoutingConfidence;
  /** Normalized source when one is recognized in the message. */
  readonly source?: string;
  /**
   * FR-26: installed-skill name recognized in an update/repair/configure/
   * uninstall phrase ("repair the installed video-use skill"). The
   * lifecycle tools resolve it to an installation id server-side.
   */
  readonly skillName?: string;
  readonly allowedEntryPoint: SkillAllowedEntryPoint;
  readonly reasonCode: string;
}

export const SKILL_ROUTING_POLICY_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

/** A supported repository URL or local package reference. */
const SOURCE_SIGNAL_RE =
  /(?:https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|https?:\/\/[^\s]*\.git\b(?:\s|$)|git@[^\s]+:[^\s]+|^[A-Za-z]:\\|^\.{0,2}\/[^\s]*|\b(?:zip|tar\.gz|tgz)\b)/i;

/** Skill/plugin/package capability nouns. */
const SKILL_NOUN_RE =
  /\b(skill|skills|plugin|plugins|agent skill|claude skill|extension|skill package)\b/i;

/** Lifecycle verbs that pair with the nouns above. */
const LIFECYCLE_VERB_RE =
  /\b(install|set\s?up|setup|register|add|update|upgrade|repair|fix|reinstall|configure|uninstall|remove)\b/i;

/**
 * Phrases that are unmistakably about a skill lifecycle even without a URL —
 * e.g. "repair the installed video-use skill", "update my skills".
 */
const EXPLICIT_LIFECYCLE_PHRASE_RE =
  /\b(?:installed|existing|my)\s+(?:skill|plugin)s?\b[^.]{0,80}?\b(?:update|upgrade|repair|fix|remove|uninstall|reinstall|configure)\b|\b(?:update|upgrade|repair|fix|remove|uninstall|reinstall|configure)\b[^.]{0,80}?\b(?:installed|existing|my)\s+(?:skill|plugin)s?\b/i;

/**
 * Negative guards — requests that superficially contain install-ish verbs
 * plus "skill"-adjacent words but are NOT skill-package lifecycles.
 */
const NOT_SKILL_INSTALL_RE =
  /\b(?:node|npm|yarn|pip|python|homebrew|brew|apt|winget|choco|chocolatey|ffmpeg|dependencies|deps|package\.json|requirements\.txt)\b[^.]{0,60}?\b(install|setup|update|upgrade)\b|\b(install|setup|update|upgrade)\b[^.]{0,60}?\b(dependencies|deps|packages?\s+for)\b/i;

/** Daily-use invocation phrasing (routes to use_skill, not the installer). */
const INVOKE_SIGNAL_RE =
  /\b(use|invoke|run|apply|follow)\b[^.]{0,60}?\b(?:the\s+)?(?:installed\s+)?skill\b|\buse_skill\b/i;

/** Executable-skill execution phrasing. */
const EXECUTE_SIGNAL_RE =
  /\b(execute|run)\b[^.]{0,40}?\b(?:the\s+)?(?:executable\s+)?(?:skill|tool)\s+(?:with|on|for)\b/i;

// ---------------------------------------------------------------------------
// FR-26 lifecycle sub-classification
// ---------------------------------------------------------------------------

interface LifecycleClassification {
  readonly intent: SkillRequestIntent;
  readonly entryPoint: SkillAllowedEntryPoint;
  readonly skillName?: string;
}

/**
 * Split the explicit lifecycle into its verb family (FR-26):
 *   - update/upgrade → update-package (skill_install_update)
 *   - repair/fix/reinstall → repair-package (skill_install_repair)
 *   - configure → configure-package (session action; resolves to update)
 *   - uninstall/remove → manage-installation (skill-management UI guidance)
 *   - install-ish verbs → install-package (skill_install_prepare, source
 *     required — prepare fails with a typed error when none was given)
 *
 * Identity-first verbs resolve an installed skill NAME server-side; a
 * missing or ambiguous name produces the bounded clarification in the
 * module's identity resolution, not a wrong entry point here.
 */
function classifyLifecycleIntent(text: string): LifecycleClassification {
  const skillName = extractInstalledSkillName(text);
  if (/\b(update|upgrade)\b/i.test(text)) {
    return {
      intent: "update-package",
      entryPoint: "skill_install_session_action",
      ...(skillName ? { skillName } : {}),
    };
  }
  if (/\b(repair|fix|reinstall)\b/i.test(text)) {
    return {
      intent: "repair-package",
      entryPoint: "skill_install_session_action",
      ...(skillName ? { skillName } : {}),
    };
  }
  if (/\bconfigure\b/i.test(text)) {
    return {
      intent: "configure-package",
      entryPoint: "skill_install_session_action",
      ...(skillName ? { skillName } : {}),
    };
  }
  if (/\b(uninstall|remove)\b/i.test(text)) {
    return {
      intent: "manage-installation",
      entryPoint: "skill_install_session_action",
      ...(skillName ? { skillName } : {}),
    };
  }
  return { intent: "install-package", entryPoint: "skill_install_prepare" };
}

/**
 * Extract the installed-skill name from an identity-first lifecycle phrase:
 * "repair the installed video-use skill", "update my scrape plugin",
 * "upgrade video-use". The name is the noun phrase before skill/plugin,
 * excluding determiners/possessives/adjectives the guard owns.
 */
export function extractInstalledSkillName(message: string): string | null {
  const text = message ?? "";
  // "the installed <name> skill/plugin" / "my <name> skill"
  const named = text.match(
    /\b(?:installed|existing|my|the)\s+([A-Za-z][A-Za-z0-9_-]{0,63})\s+(?:skill|plugin)\b/i
  );
  if (named) return named[1];
  // "<verb> <name>" — only for identity verbs with a bare token after them.
  const verbName = text.match(
    /\b(?:update|upgrade|repair|fix|reinstall|configure|uninstall|remove)\s+([A-Za-z][A-Za-z0-9_-]{1,63})\b/i
  );
  if (verbName) {
    const candidate = verbName[1];
    // Reject guard-owned words ("my", "the", "skills", "plugin", …).
    if (
      !/^(?:my|the|a|an|all|skills?|plugins?|installed|existing|dependencies|deps)$/i.test(
        candidate
      )
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Classify one user message. Pure function; the same input always yields the
 * same decision so telemetry and tests can pin behavior.
 */
export function classifySkillRequestIntent(
  message: string
): SkillRoutingDecision {
  const text = message ?? "";
  const base = { policyVersion: SKILL_ROUTING_POLICY_VERSION };

  // 1. Executable execution vs prompt invocation vs package lifecycle are
  //    distinct entry points (FR-27 boundary matrix).
  if (EXECUTE_SIGNAL_RE.test(text)) {
    return {
      ...base,
      intent: "execute-skill",
      confidence: "semantic",
      allowedEntryPoint: "executable-skill-tool",
      reasonCode: "execute-phrase",
    };
  }
  if (
    INVOKE_SIGNAL_RE.test(text) &&
    !LIFECYCLE_VERB_RE.test(text.split(INVOKE_SIGNAL_RE)[0] ?? "")
  ) {
    const hasInstallVerb =
      /\b(install|set\s?up|setup|register|update|repair|reinstall|configure)\b/i.test(
        text
      );
    if (!hasInstallVerb) {
      return {
        ...base,
        intent: "invoke-prompt-skill",
        confidence: "semantic",
        allowedEntryPoint: "use_skill",
        reasonCode: "invoke-phrase",
      };
    }
  }

  const hasSkillNoun = SKILL_NOUN_RE.test(text);
  const hasSource = SOURCE_SIGNAL_RE.test(text);
  const hasLifecycleVerb = LIFECYCLE_VERB_RE.test(text);
  const hasExplicitLifecyclePhrase =
    EXPLICIT_LIFECYCLE_PHRASE_RE.test(text) && hasSkillNoun;
  const isNotSkillInstall = NOT_SKILL_INSTALL_RE.test(text);

  // High-confidence explicit (FR-01): a lifecycle verb combined with EITHER
  // a skill/package noun OR a supported source ("Set up <github url>") —
  // minus the negative guards for ordinary dependency/Git work.
  // (hasExplicitLifecyclePhrase implies hasSkillNoun by construction.)
  if (!isNotSkillInstall && hasLifecycleVerb && (hasSkillNoun || hasSource)) {
    // FR-26: the verb selects the intent and entry point. Install-ish verbs
    // start at prepare (a source is required); update/repair/configure act
    // on an EXISTING installation through the session-scoped lifecycle
    // tools (skill_install_update / _repair / _status), which resolve the
    // installed identity server-side by name or id; uninstall/remove is a
    // management operation the assistant guides to the skill-management UI.
    const lifecycle = classifyLifecycleIntent(text);
    const src = extractSource(text);
    return {
      ...base,
      intent: lifecycle.intent,
      confidence: "explicit",
      ...(src ? { source: src } : {}),
      ...(lifecycle.skillName ? { skillName: lifecycle.skillName } : {}),
      allowedEntryPoint: lifecycle.entryPoint,
      reasonCode: hasSource
        ? "skill-noun-plus-source"
        : hasExplicitLifecyclePhrase
        ? "explicit-lifecycle-phrase"
        : "skill-noun-plus-verb",
    };
  }

  // Source present but no skill noun — ordinary git clone / dependency work.
  if (hasSource && !hasSkillNoun) {
    return {
      ...base,
      intent: "unrelated",
      confidence: "ambiguous",
      allowedEntryPoint: "normal-tool-policy",
      reasonCode: "source-without-skill-signal",
    };
  }

  return {
    ...base,
    intent: "unrelated",
    confidence: "ambiguous",
    allowedEntryPoint: "normal-tool-policy",
    reasonCode: "no-skill-install-signal",
  };
}

/** Extract the first supported source string from a message, if any. */
export function extractSource(message: string): string | null {
  const github = message.match(
    /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/i
  );
  if (github) return github[0];
  const gitUrl = message.match(/https?:\/\/[^\s]*\.git\b|git@[^\s]+:[^\s]+/i);
  if (gitUrl) return gitUrl[0];
  const localPath = message.match(
    /(?:[A-Za-z]:\\[\w\\.-]*|\.{0,2}\/?[\w.-]+\/[\w./-]+\.(?:zip|tgz|tar\.gz))/
  );
  if (localPath) return localPath[0];
  return null;
}
