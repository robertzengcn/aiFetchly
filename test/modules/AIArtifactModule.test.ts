import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import sinon from "sinon";

import { AIArtifactModule } from "@/modules/AIArtifactModule";
import { AIArtifactModel } from "@/model/AIArtifact.model";
import type { AIArtifactEntity } from "@/entity/AIArtifact.entity";

/**
 * Unit tests for AIArtifactModule business logic.
 *
 * The Model prototype is stubbed so the module's id-generation, version
 * bookkeeping, and entity→record/summary mapping are exercised without a
 * real TypeORM DataSource (entities are not registered in the Mocha env,
 * so direct DB calls would throw EntityMetadataNotFoundError). The module
 * constructor succeeds because BaseModule falls back to a temp dir when
 * USERSDBPATH is unset.
 */
describe("AIArtifactModule", function () {
  this.timeout(5000);

  let mod: AIArtifactModule;

  beforeEach(function () {
    sinon.restore();
    // ensureConnection() hits SqliteDb.ensureInitialized(); stub it so the
    // module never touches the uninitialized test DataSource.
    sinon.stub(AIArtifactModule.prototype, "ensureConnection").resolves();
    mod = new AIArtifactModule();
  });

  afterEach(function () {
    sinon.restore();
  });

  function makeEntity(overrides: Partial<AIArtifactEntity> = {}): AIArtifactEntity {
    return {
      id: 1,
      artifactId: "artifact-1",
      conversationId: "v2-test",
      type: "html",
      title: "Report",
      description: undefined,
      mimeType: "text/html",
      content: "<p>hi</p>",
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    } as unknown as AIArtifactEntity;
  }

  it("createHtmlArtifact generates an id, starts at version 1, and maps to a record", async function () {
    sinon.stub(AIArtifactModel.prototype, "getLatestVersion").resolves(0);
    const saveStub = sinon
      .stub(AIArtifactModel.prototype, "saveArtifact")
      .callsFake(async (entity: AIArtifactEntity) => entity);

    const record = await mod.createHtmlArtifact({
      conversationId: "v2-test",
      title: "Report",
      html: "<p>hi</p>",
    });

    expect(record.id).to.match(/^artifact-/);
    expect(record.conversationId).to.equal("v2-test");
    expect(record.type).to.equal("html");
    expect(record.mimeType).to.equal("text/html");
    expect(record.content).to.equal("<p>hi</p>");
    expect(record.version).to.equal(1);
    // The saved entity carried the generated id and computed version.
    const saved = saveStub.firstCall.args[0] as AIArtifactEntity;
    expect(saved.artifactId).to.equal(record.id);
    expect(saved.version).to.equal(1);
  });

  it("createHtmlArtifact increments version for a repeated title", async function () {
    const latest = sinon.stub(AIArtifactModel.prototype, "getLatestVersion");
    latest.onFirstCall().resolves(1);
    latest.onSecondCall().resolves(2);
    sinon
      .stub(AIArtifactModel.prototype, "saveArtifact")
      .callsFake(async (entity: AIArtifactEntity) => entity);

    const first = await mod.createHtmlArtifact({
      conversationId: "v2-test",
      title: "Report",
      html: "<p>v2</p>",
    });
    const second = await mod.createHtmlArtifact({
      conversationId: "v2-test",
      title: "Report",
      html: "<p>v3</p>",
    });

    expect(first.version).to.equal(2);
    expect(second.version).to.equal(3);
    expect(second.id).to.not.equal(first.id);
  });

  it("getArtifact returns the full content record", async function () {
    sinon
      .stub(AIArtifactModel.prototype, "getByArtifactId")
      .resolves(makeEntity({ artifactId: "artifact-x", content: "<b>full</b>" }));

    const record = await mod.getArtifact("artifact-x");
    expect(record).to.not.equal(null);
    expect(record?.id).to.equal("artifact-x");
    expect(record?.content).to.equal("<b>full</b>");
  });

  it("getArtifact returns null when the artifact is missing", async function () {
    sinon.stub(AIArtifactModel.prototype, "getByArtifactId").resolves(null);
    expect(await mod.getArtifact("nope")).to.equal(null);
  });

  it("listArtifacts returns summaries without content", async function () {
    sinon.stub(AIArtifactModel.prototype, "listByConversation").resolves([
      makeEntity({ artifactId: "a1", title: "One", version: 1 }),
      makeEntity({ artifactId: "a2", title: "Two", version: 2 }),
    ]);

    const summaries = await mod.listArtifacts("v2-test");
    expect(summaries).to.have.lengthOf(2);
    for (const s of summaries) {
      expect(s).to.not.have.property("content");
      expect(s.type).to.equal("html");
    }
    expect(summaries[0].id).to.equal("a1");
    expect(summaries[1].version).to.equal(2);
  });

  it("deleteByConversation delegates to the model and returns affected count", async function () {
    const del = sinon
      .stub(AIArtifactModel.prototype, "deleteByConversation")
      .resolves(3);
    expect(await mod.deleteByConversation("v2-test")).to.equal(3);
    expect(del.calledOnceWith("v2-test")).to.equal(true);
  });
});
