/**
 * Unit tests for the recoverable-history rollout flag helpers
 * (technical-design §18). All four flags default OFF and fail closed on an
 * unreadable Token store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const flagStore: Record<string, string> = {};
// When true, Token.getValue throws to simulate an unreadable encrypted store.
let storeUnreadable = false;

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      if (storeUnreadable) {
        throw new Error("encrypted store unreadable");
      }
      return flagStore[name] ?? "";
    }
    setValue(name: string, value: string) {
      flagStore[name] = value;
    }
  },
}));

import {
  isArchiveReadsEnabled,
  isNewCompactionEnabled,
  isHistoryToolsEnabled,
  isHistoryUiEnabled,
  enableRecoverableHistoryFlags,
} from "@/config/featureFlags";
import { AI_CHAT_RECOVERABLE_FLAGS } from "@/service/AIChatRecoverableDefaults";

beforeEach(() => {
  // Wipe between tests so each starts from the default-OFF state.
  for (const key of Object.keys(flagStore)) delete flagStore[key];
  storeUnreadable = false;
});

afterEach(() => {
  for (const key of Object.keys(flagStore)) delete flagStore[key];
  storeUnreadable = false;
});

describe("recoverable-history rollout flags — default OFF + fail-closed", () => {
  it("all four flags are off when the Token store has no value", () => {
    expect(isArchiveReadsEnabled()).toBe(false);
    expect(isNewCompactionEnabled()).toBe(false);
    expect(isHistoryToolsEnabled()).toBe(false);
    expect(isHistoryUiEnabled()).toBe(false);
  });

  it("enabling a flag requires the explicit value 'true'", () => {
    flagStore[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "true";
    expect(isArchiveReadsEnabled()).toBe(true);
    // A non-"true" value (e.g. "1", "yes") does NOT enable.
    flagStore[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "1";
    expect(isArchiveReadsEnabled()).toBe(false);
  });

  it("flags are independent (stage-1 ≠ stage-2 ≠ stage-3)", () => {
    flagStore[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "true";
    expect(isArchiveReadsEnabled()).toBe(true);
    expect(isNewCompactionEnabled()).toBe(false);
    expect(isHistoryToolsEnabled()).toBe(false);
    expect(isHistoryUiEnabled()).toBe(false);

    flagStore[AI_CHAT_RECOVERABLE_FLAGS.newCompaction] = "true";
    expect(isNewCompactionEnabled()).toBe(true);
    expect(isHistoryToolsEnabled()).toBe(false);
    expect(isHistoryUiEnabled()).toBe(false);

    flagStore[AI_CHAT_RECOVERABLE_FLAGS.historyTools] = "true";
    flagStore[AI_CHAT_RECOVERABLE_FLAGS.historyUi] = "true";
    expect(isHistoryToolsEnabled()).toBe(true);
    expect(isHistoryUiEnabled()).toBe(true);
  });
});

describe("recoverable-history rollout flags — fail-closed on store error", () => {
  it("returns false when Token.getValue throws", () => {
    storeUnreadable = true;
    // The shared Token mock throws on getValue; all flags must fail CLOSED.
    expect(isArchiveReadsEnabled()).toBe(false);
    expect(isNewCompactionEnabled()).toBe(false);
    expect(isHistoryToolsEnabled()).toBe(false);
    expect(isHistoryUiEnabled()).toBe(false);
  });
});

describe("recoverable-history rollout flags — operator enablement helper", () => {
  it("enableRecoverableHistoryFlags turns all four stages on without changing defaults for other tests", () => {
    expect(isNewCompactionEnabled()).toBe(false);
    enableRecoverableHistoryFlags();
    expect(isArchiveReadsEnabled()).toBe(true);
    expect(isNewCompactionEnabled()).toBe(true);
    expect(isHistoryToolsEnabled()).toBe(true);
    expect(isHistoryUiEnabled()).toBe(true);
  });
});
