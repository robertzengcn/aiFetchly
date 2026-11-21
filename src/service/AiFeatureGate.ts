/**
 * AiFeatureGate — single source of truth for the USER_AI_ENABLED check.
 *
 * Project rule (CLAUDE.md): AI-feature IPC handlers must check AI enable
 * first, before parsing request data or calling AI APIs. This helper makes
 * that check reusable from both `registerAiValidatedHandler` (handle-based)
 * and the streaming `ipcMain.on` upload path (SAVE_TEMP_FILE), which cannot
 * use the wrapper directly because it pushes progress over `event.sender`.
 *
 * Fail-closed: if the Token store is unreachable (DB not initialized,
 * encrypted store corrupted), the helper returns false rather than letting a
 * broken gate silently enable paid features.
 *
 * FR-6 (lazy reconciliation): when the gate is currently closed, opening a
 * hosted-AI surface runs one reconciliation before failing, so a user who
 * just paid (but the notify/cache hasn't caught up) is unlocked without a
 * remount. Hosted-only — local-provider chat does not go through this.
 */
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { SubscriptionEntitlementService } from "@/service/SubscriptionEntitlementService";
import { AIProviderResolver } from "@/service/aiProvider/AIProviderResolver";

export function isAiEnabled(): boolean {
  try {
    return new Token().getValue(USER_AI_ENABLED) === "true";
  } catch {
    return false;
  }
}

/**
 * Checks whether AI features are available either via a hosted subscription
 * (`USER_AI_ENABLED === "true"`) OR via a configured local/custom AI provider.
 *
 * Used by Chat and Tool execution paths (such as Browser Use / Managed Browser)
 * so users who configure their own custom/local AI provider can use AI automation
 * without being blocked by hosted subscription checks.
 */
export function isAiOrProviderEnabled(): boolean {
  try {
    const resolver = new AIProviderResolver();
    const resolution = resolver.resolveForChat();
    if (resolution.canUse) {
      return true;
    }
  } catch {
    // Fall back to Token check
  }
  return isAiEnabled();
}

/**
 * Provider-aware lazy reconciliation gate.
 *
 * Returns true immediately if a local AI provider is configured and enabled,
 * or if hosted AI is enabled. Otherwise, runs one lazy reconciliation pass
 * before failing closed.
 */
export async function ensureAiOrProviderEnabled(): Promise<boolean> {
  try {
    const resolver = new AIProviderResolver();
    const resolution = resolver.resolveForChat();
    if (resolution.canUse) {
      return true;
    }
    // Only attempt lazy reconcile if hosted subscription is required
    if (
      "reason" in resolution &&
      resolution.reason === "hosted_subscription_required"
    ) {
      try {
        await SubscriptionEntitlementService.getInstance().reconcile(
          "gated_feature"
        );
      } catch {
        // Reconcile failures keep the cache; fail closed below.
      }
      return resolver.resolveForChat().canUse;
    }
  } catch {
    // Fall back to hosted check
  }
  return ensureHostedAiEnabled();
}

/**
 * Lazy reconciliation gate (PRD FR-6).
 *
 * Returns true immediately if AI is already enabled. Otherwise runs one
 * `gated_feature` reconcile (cooldown-gated to 30s so a user mashing Chat
 * can't stampede /api/user/info), then re-reads the flag. If the server now
 * reports an AI plan, unlock and continue; if not, keep failing closed.
 *
 * The reconcile GET failure path keeps the existing cache, so a transient
 * network error never unlocks a Community user (PRD §5.3).
 */
export async function ensureHostedAiEnabled(): Promise<boolean> {
  if (isAiEnabled()) return true;
  try {
    await SubscriptionEntitlementService.getInstance().reconcile(
      "gated_feature"
    );
  } catch {
    // Reconcile failures keep the cache; fail closed below.
  }
  return isAiEnabled();
}
