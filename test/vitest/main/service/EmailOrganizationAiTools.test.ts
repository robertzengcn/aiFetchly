import { describe, it, expect, vi, beforeEach } from "vitest";
import { setLocationBackfillReady } from "@/service/emailOrganization/emailOrganizationReadiness";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

// R16/R03/R10 review coverage: entitlement gate before parse, scheduled
// origin guard, and the honest R10 outcome envelope mapping.

const aiEnabled = { value: true };
vi.mock("@/service/AiFeatureGate", () => ({
  ensureHostedAiEnabled: () => Promise.resolve(aiEnabled.value),
  isAiEnabled: () => aiEnabled.value,
}));

const moveTrash = vi.fn();
vi.mock("@/service/emailOrganization/EmailMailboxActionService", () => ({
  EmailMailboxActionService: class {
    constructor() {
      return { trashMessage: moveTrash };
    }
  },
}));

const sendForward = vi.fn();
vi.mock("@/service/emailOrganization/EmailForwardDeliveryService", () => ({
  EmailForwardDeliveryService: class {
    constructor() {
      return { sendApprovedForward: sendForward };
    }
  },
}));

vi.mock("@/modules/EmailForwardDraftModule", () => ({
  EmailForwardDraftModule: class {
    readRevision = vi.fn().mockResolvedValue({
      id: 21,
      draftId: 11,
      composedHash: "a".repeat(64),
    });
  },
}));

vi.mock("@/modules/EmailOrganizationAuthorizationModule", () => ({
  EmailOrganizationAuthorizationModule: class {
    issue = vi.fn().mockResolvedValue({ id: 5 });
  },
}));

import {
  moveEmailToTrash,
  sendEmailForward,
  restoreEmail,
} from "@/service/EmailOrganizationAiTools";

const baseContext: SkillExecutionContext = {
  conversationId: "c1",
  toolCallId: "t1",
};

describe("R16 — entitlement gate before parsing (review)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiEnabled.value = true;
    // R6-10: the readiness gate runs BEFORE entitlement (host infra state).
    // The startup backfill completed in this simulated process, so the
    // AI_DISABLED assertion tests the entitlement gate specifically.
    setLocationBackfillReady(true);
  });

  for (const [name, call] of [
    ["move_email_to_trash", () => moveEmailToTrash({}, baseContext)],
    ["send_email_forward", () => sendEmailForward({ draft_id: 1, revision_id: 1 }, baseContext)],
    ["restore_email", () => restoreEmail({ operation_id: "op-12345678" }, baseContext)],
  ] as const) {
    it(`returns AI_DISABLED before any work for ${name} when AI is off`, async () => {
      aiEnabled.value = false;
      const result = await call();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe("AI_DISABLED");
      expect(moveTrash).not.toHaveBeenCalled();
      expect(sendForward).not.toHaveBeenCalled();
    });
  }
});

describe("R03 — scheduled-origin service guard (review)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiEnabled.value = true;
  });

  it("refuses mutations from scheduled executions before dispatch", async () => {
    const result = await moveEmailToTrash(
      { message_id: 42 },
      { ...baseContext, scheduledOrigin: true }
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("ACTION_NOT_AUTHORIZED");
    expect(moveTrash).not.toHaveBeenCalled();
  });
});

describe("R10 — honest outcome envelope (review)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiEnabled.value = true;
    moveTrash.mockResolvedValue({
      success: false,
      errorCode: "SOURCE_NOT_FOUND",
    });
  });

  it("maps a refused mailbox action to a failure envelope with the code", async () => {
    const result = await moveEmailToTrash({ message_id: 42 }, baseContext);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SOURCE_NOT_FOUND");
  });

  it("surfaces partial recipient acceptance as a non-success envelope", async () => {
    const { EmailForwardDraftService: _x } = await import("@/service/emailOrganization/EmailForwardDraftService");
    void _x;
    sendForward.mockResolvedValue({
      status: "submitted",
      outcome: "partially_succeeded",
      operationId: "op-1",
      accepted: ["a@b.test"],
      rejected: ["c@d.test"],
      unknown: [],
      requestCorrelationId: "r1",
    });
    const result = await sendEmailForward({ draft_id: 11, revision_id: 21 }, baseContext);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PARTIAL_RECIPIENT_ACCEPTANCE");
      expect(result.result).toBeDefined();
    }
  });
});
