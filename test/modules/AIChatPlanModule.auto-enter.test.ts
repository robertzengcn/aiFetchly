import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import sinon from "sinon";

import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { AIChatPlanModel } from "@/model/AIChatPlan.model";
import { AIChatPlanVersionModel } from "@/model/AIChatPlanVersion.model";
import { AIChatPlanQuestionModel } from "@/model/AIChatPlanQuestion.model";
import type { AIChatPlanEntity } from "@/entity/AIChatPlan.entity";

/**
 * Idempotency tests for AIChatPlanModule.ensurePlanForConversation.
 *
 * EnterPlanMode calls this method to create-or-reuse a plan. If the model
 * calls EnterPlanMode multiple times (or the engine retries after a
 * transient error), the same planId must be returned for the same
 * conversation — never a duplicate plan record.
 *
 * Approach: We stub the Model prototypes (AIChatPlanModel,
 * AIChatPlanVersionModel, AIChatPlanQuestionModel) so that
 * ensurePlanForConversation's branching logic is exercised without
 * requiring a real SQLite/TypeORM DataSource. The module's own
 * constructor succeeds in the Mocha environment (BaseModule falls back to
 * a temp directory when USERSDBPATH is unset), but the TypeORM entities
 * are not registered with the test DataSource, so direct DB calls would
 * throw EntityMetadataNotFoundError. Sinon stubs avoid that path while
 * still testing the real branching logic in ensurePlanForConversation.
 */
describe("AIChatPlanModule.ensurePlanForConversation idempotency", function () {
  this.timeout(5000);

  let mod: AIChatPlanModule;

  beforeEach(function () {
    sinon.restore();
    mod = new AIChatPlanModule();
  });

  afterEach(function () {
    sinon.restore();
  });

  it("returns the same planId when called twice on the same conversation", async function () {
    const fakePlan = {
      planId: "plan-existing-idem-001",
      conversationId: "v2-test-idempotent",
      status: "draft",
      title: "First call",
      objective: "Original objective",
      currentVersion: 0,
      approvedAt: null,
      rejectedAt: null,
    } as unknown as AIChatPlanEntity;

    const getActiveStub = sinon
      .stub(AIChatPlanModel.prototype, "getActiveByConversation")
      .resolves(fakePlan);
    sinon.stub(AIChatPlanModel.prototype, "getByPlanId").resolves(fakePlan);
    sinon.stub(AIChatPlanVersionModel.prototype, "getLatest").resolves(null);
    sinon
      .stub(AIChatPlanQuestionModel.prototype, "getPendingByPlan")
      .resolves(null);

    const first = await mod.ensurePlanForConversation({
      conversationId: "v2-test-idempotent",
      title: "First call",
      objective: "Original objective",
    });
    const second = await mod.ensurePlanForConversation({
      conversationId: "v2-test-idempotent",
      title: "Second call",
      objective: "Should be ignored — plan already exists",
    });

    // Critical contract: same planId returned on both calls.
    expect(second.planId).to.equal(first.planId);
    expect(second.planId).to.equal("plan-existing-idem-001");
    // Title/objective from the second call must NOT overwrite the first.
    expect(second.title).to.equal("First call");
    expect(second.objective).to.equal("Original objective");
    // getActiveByConversation should be called on each invocation
    // (once per ensurePlanForConversation call).
    expect(getActiveStub.callCount).to.equal(2);
    // createPlan should NEVER be called when an active plan exists.
  });

  it("creates a new plan when no active plan exists", async function () {
    const createdPlan = {
      planId: "plan-new-fresh-002",
      conversationId: "v2-test-new-conv",
      status: "draft",
      title: "Fresh plan",
      objective: "new obj",
      currentVersion: 0,
      approvedAt: null,
      rejectedAt: null,
    } as unknown as AIChatPlanEntity;

    const getActiveStub = sinon
      .stub(AIChatPlanModel.prototype, "getActiveByConversation")
      .resolves(null);
    const createStub = sinon
      .stub(AIChatPlanModel.prototype, "createPlan")
      .resolves(createdPlan);
    sinon.stub(AIChatPlanModel.prototype, "getByPlanId").resolves(createdPlan);
    sinon.stub(AIChatPlanVersionModel.prototype, "getLatest").resolves(null);
    sinon
      .stub(AIChatPlanQuestionModel.prototype, "getPendingByPlan")
      .resolves(null);

    const result = await mod.ensurePlanForConversation({
      conversationId: "v2-test-new-conv",
      title: "Fresh plan",
      objective: "new obj",
    });

    expect(result.planId).to.equal("plan-new-fresh-002");
    expect(result.title).to.equal("Fresh plan");
    expect(getActiveStub.calledOnce).to.be.true;
    expect(createStub.calledOnce).to.be.true;
  });

  it("rejects a non-v2 conversation id", async function () {
    let threw = false;
    try {
      await mod.ensurePlanForConversation({
        conversationId: "not-a-v2-conversation",
        title: "x",
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.contain("v2-");
    }
    expect(threw).to.be.true;
  });
});
