/**
 * Pure, runtime-neutral text normalization for conversation reports (design §8).
 * Used by request construction in the renderer AND mirrored defensively in the
 * main-process service before HTTP submission.
 *
 * Bounds (PRD §10.4 / design §8):
 *  - per-item: 8,000 chars
 *  - aggregate: 32,000 chars across at most 20 text items
 * With ≤20 items, every non-empty selected item retains ≥1,600 chars before
 * marker overhead. No selected item is silently dropped.
 */

export const MAX_CONVERSATION_ITEM_TEXT = 8_000;
export const MAX_CONVERSATION_AGGREGATE_TEXT = 32_000;

const TRUNCATION_MARKER = "\n…[truncated]…\n";

export interface NormalizedConversationText {
  readonly texts: readonly {
    itemId: string;
    text: string;
    truncated: boolean;
  }[];
  readonly aggregateTruncated: boolean;
}

interface ItemInput {
  itemId: string;
  text: string;
}

/** Head-marker-tail clamp for a single item to a target max length. */
function clampWithMarker(
  text: string,
  max: number
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const tailLen = 28;
  const headLen = Math.max(0, max - TRUNCATION_MARKER.length - tailLen);
  const head = text.slice(0, headLen);
  const tail = text.slice(text.length - tailLen);
  return { text: `${head}${TRUNCATION_MARKER}${tail}`, truncated: true };
}

/**
 * Algorithm (design §8):
 * 1. Clamp every item to 8,000 chars (head-marker-tail).
 * 2. If aggregate ≤ 32,000, return per-item results.
 * 3. Else allocate floor(32,000 / textItemCount) chars per item, capped at the
 *    item's actual clamped length and at 8,000.
 * 4. Redistribute unused budget in chronological order to items that still
 *    need capacity.
 * 5. Truncate affected items with the same head-marker-tail helper.
 * 6. Set per-item and aggregate truncation flags.
 */
export function normalizeConversationTexts(
  inputs: readonly ItemInput[]
): NormalizedConversationText {
  if (inputs.length === 0) {
    return { texts: [], aggregateTruncated: false };
  }

  // Step 1: per-item clamp.
  const clamped = inputs.map((inp) =>
    clampWithMarker(inp.text, MAX_CONVERSATION_ITEM_TEXT)
  );

  // Step 2: aggregate check.
  const aggregateLen = clamped.reduce((n, c) => n + c.text.length, 0);
  if (aggregateLen <= MAX_CONVERSATION_AGGREGATE_TEXT) {
    return {
      texts: clamped.map((c, i) => ({
        itemId: inputs[i].itemId,
        text: c.text,
        truncated: c.truncated,
      })),
      aggregateTruncated: false,
    };
  }

  // Step 3: allocate even budget.
  const count = clamped.length;
  const perItem = Math.floor(MAX_CONVERSATION_AGGREGATE_TEXT / count);
  const floored = Math.min(perItem, MAX_CONVERSATION_ITEM_TEXT);

  const budgets = clamped.map((c) => Math.min(c.text.length, floored));
  const used = budgets.reduce((n, b) => n + b, 0);

  // Step 4: redistribute unused budget in chronological order.
  let remaining = MAX_CONVERSATION_AGGREGATE_TEXT - used;
  for (let i = 0; i < count && remaining > 0; i++) {
    const current = clamped[i].text.length;
    const room = MAX_CONVERSATION_ITEM_TEXT - budgets[i];
    const give = Math.min(room, current - budgets[i], remaining);
    if (give > 0) {
      budgets[i] += give;
      remaining -= give;
    }
  }

  // Step 5: re-truncate affected items.
  const texts = clamped.map((c, i) => {
    if (c.text.length <= budgets[i]) {
      return { itemId: inputs[i].itemId, text: c.text, truncated: c.truncated };
    }
    const r = clampWithMarker(c.text, budgets[i]);
    return { itemId: inputs[i].itemId, text: r.text, truncated: true };
  });

  return {
    texts,
    aggregateTruncated: true,
  };
}

/**
 * Pure, synchronous truncation pre-check for the dialog's warn-before-submit
 * gate (PRD FR-4.4, §10.4, Journey 11.1 step 7). Delegates to
 * {@link normalizeConversationTexts} so the warning fires exactly when the
 * real submission would truncate — never a false positive or a miss.
 *
 * Returns true when ANY selected text item would be clamped per-item OR the
 * aggregate would exceed the 32,000-char budget.
 */
export function wouldTruncateConversationTexts(
  inputs: readonly ItemInput[]
): boolean {
  if (inputs.length === 0) return false;
  const normalized = normalizeConversationTexts(inputs);
  return (
    normalized.aggregateTruncated ||
    normalized.texts.some((text) => text.truncated)
  );
}
