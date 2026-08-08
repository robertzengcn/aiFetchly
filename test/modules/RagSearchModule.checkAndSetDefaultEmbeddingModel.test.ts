import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { RagSearchModule } from "@/modules/RagSearchModule";
import { LOCAL_XENOVA_ALL_MINILM_MODEL_ID } from "@/service/embedding/LocalEmbeddingModels";

/**
 * Subset of RagSearchModule exercised by checkAndSetDefaultEmbeddingModel.
 * Built with Object.create(prototype) + stubbed collaborators so the test never
 * touches Electron's `app` or SQLite.
 */
interface TestableRagSearchModule {
  checkAndSetDefaultEmbeddingModel(): Promise<void>;
  systemSettingModule: {
    getDefaultEmbeddingModel(): Promise<{
      modelName: string;
      dimension: number;
    } | null>;
    updateDefaultEmbeddingModel(
      modelName: string,
      dimension: number,
      group: unknown
    ): Promise<unknown>;
  };
  systemSettingGroupModule: {
    getOrCreateEmbeddingGroup(): Promise<unknown>;
  };
  ragConfigApi: {
    getAvailableEmbeddingModels(): Promise<unknown>;
  };
}

/**
 * Remote-only model list, exactly as returned by the AI server. Critically, it
 * does NOT contain the local Xenova model — local models are never advertised
 * by the remote API. jina is the server's reported default.
 */
function remoteOnlyModelsResponse(): unknown {
  return {
    status: true,
    data: {
      models: {
        "jina-embeddings-v5-text-small": {
          name: "jina-embeddings-v5-text-small",
          dimensions: 1024,
        },
      },
      default_model: "jina-embeddings-v5-text-small",
      default_dimensions: 1024,
      total_models: 1,
      configured_models: 1,
    },
  };
}

describe("RagSearchModule.checkAndSetDefaultEmbeddingModel", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("preserves a user-selected local model instead of overwriting it with the remote default", async () => {
    const updateDefaultEmbeddingModel = sinon.stub().resolves();
    const moduleUnderTest = Object.create(
      RagSearchModule.prototype
    ) as TestableRagSearchModule;

    Object.assign(moduleUnderTest, {
      systemSettingModule: {
        getDefaultEmbeddingModel: sinon.stub().resolves({
          modelName: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
          dimension: 384,
        }),
        updateDefaultEmbeddingModel,
      },
      systemSettingGroupModule: {
        getOrCreateEmbeddingGroup: sinon.stub().resolves({ id: 1 }),
      },
      ragConfigApi: {
        getAvailableEmbeddingModels: sinon
          .stub()
          .resolves(remoteOnlyModelsResponse()),
      },
    });

    await moduleUnderTest.checkAndSetDefaultEmbeddingModel();

    // The local model is always available on-device. It must NOT be replaced by
    // the remote default just because it is absent from the remote model list.
    expect(
      updateDefaultEmbeddingModel.called,
      "local default model must not be overwritten by the remote default"
    ).to.equal(false);
  });

  it("keeps a remote model that is still advertised by the server", async () => {
    const updateDefaultEmbeddingModel = sinon.stub().resolves();
    const moduleUnderTest = Object.create(
      RagSearchModule.prototype
    ) as TestableRagSearchModule;

    Object.assign(moduleUnderTest, {
      systemSettingModule: {
        getDefaultEmbeddingModel: sinon.stub().resolves({
          modelName: "jina-embeddings-v5-text-small",
          dimension: 1024,
        }),
        updateDefaultEmbeddingModel,
      },
      systemSettingGroupModule: {
        getOrCreateEmbeddingGroup: sinon.stub().resolves({ id: 1 }),
      },
      ragConfigApi: {
        getAvailableEmbeddingModels: sinon
          .stub()
          .resolves(remoteOnlyModelsResponse()),
      },
    });

    await moduleUnderTest.checkAndSetDefaultEmbeddingModel();

    expect(
      updateDefaultEmbeddingModel.called,
      "an available remote model must not be overwritten"
    ).to.equal(false);
  });
});
