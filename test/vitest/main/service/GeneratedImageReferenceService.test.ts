import { afterEach, describe, expect, it } from "vitest";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Stats } from "node:fs";
import { MessageType } from "@/entityTypes/commonType";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import type {
  ChatV2GeneratedImageReference,
} from "@/entityTypes/aiChatV2Types";
import {
  GeneratedImageReferenceError,
  type GeneratedImageReferenceErrorCode,
} from "@/entityTypes/generatedImageReferenceTypes";
import {
  AI_CHAT_GENERATED_IMAGE_HOST,
  AI_CHAT_GENERATED_IMAGE_PROTOCOL,
  buildGeneratedImageProtocolUrl,
  getGeneratedImageUserRoot,
  sanitizeGeneratedImagePathPart,
} from "@/service/AIChatGeneratedImageProtocol";
import type {
  OpenedReadFile,
} from "@/service/AIImageAttachmentToolService";
import type {
  GeneratedImageReferenceServiceDeps,
} from "@/service/GeneratedImageReferenceService";
import { GeneratedImageReferenceService } from "@/service/GeneratedImageReferenceService";
import type { PreparedModelImage } from "@/service/GeneratedImagePreparationService";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

interface Fixture {
  readonly tmpRoot: string;
  readonly userDataPath: string;
  readonly email: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly filePath: string;
}

const fixtures: Fixture[] = [];

async function makeFixture(): Promise<Fixture> {
  const tmpRoot = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "gen-img-ref-")
  );
  const userDataPath = path.join(tmpRoot, "userdata");
  const email = "user@example.com";
  const conversationId = "v2-conv1";
  const messageId = "assistant-1";
  const msgDir = path.join(
    getGeneratedImageUserRoot(userDataPath, email),
    sanitizeGeneratedImagePathPart(conversationId),
    sanitizeGeneratedImagePathPart(messageId)
  );
  await fsPromises.mkdir(msgDir, { recursive: true });
  const filePath = path.join(msgDir, "image-1.png");
  await fsPromises.writeFile(filePath, PNG_1X1);
  await fsPromises.writeFile(path.join(msgDir, "image-2.png"), PNG_1X1);
  const fixture: Fixture = {
    tmpRoot,
    userDataPath,
    email,
    conversationId,
    messageId,
    filePath,
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  const pending = fixtures.splice(0);
  await Promise.all(
    pending.map((f) => fsPromises.rm(f.tmpRoot, { recursive: true, force: true }))
  );
});

function makeEntity(fixture: Fixture, metadata: string): AIChatMessageEntity {
  return {
    messageId: fixture.messageId,
    conversationId: fixture.conversationId,
    role: "assistant",
    content: "",
    timestamp: new Date(),
    metadata,
    messageType: MessageType.MESSAGE,
  } as AIChatMessageEntity;
}

function descriptorMetadata(
  userEmail: string,
  conversationId: string,
  messageId: string,
  fileName: string
): string {
  return JSON.stringify({
    source: "chat-v2",
    generatedImages: [
      {
        type: "image",
        url: buildGeneratedImageProtocolUrl({
          userEmail,
          conversationId,
          messageId,
          fileName,
        }),
        file_name: fileName,
      },
      {
        type: "image",
        url: buildGeneratedImageProtocolUrl({
          userEmail,
          conversationId,
          messageId,
          fileName: "image-2.png",
        }),
        file_name: "image-2.png",
      },
    ],
  });
}

function fdPinnedOpenForRead(): (p: string) => Promise<OpenedReadFile> {
  return async (p) => {
    const handle = await fsPromises.open(p, "r");
    const stats = await handle.stat();
    return {
      stats,
      read: () => handle.readFile(),
      close: () => handle.close(),
    };
  };
}

function makeFakeStats(overrides: {
  isFile?: boolean;
  isSymbolicLink?: boolean;
  size?: number;
}): Stats {
  const isFile = overrides.isFile ?? true;
  return {
    isFile: () => isFile,
    isSymbolicLink: () => overrides.isSymbolicLink ?? false,
    size: overrides.size ?? PNG_1X1.length,
  } as unknown as Stats;
}

function cannedPrepared(dataUrl = "data:image/png;base64,QUJD"): PreparedModelImage {
  return {
    mimeType: "image/png",
    width: 1,
    height: 1,
    preparedSizeBytes: 3,
    dataUrl,
  };
}

interface Harness {
  readonly service: GeneratedImageReferenceService;
  readonly prepareCalls: number;
}

function makeService(
  fixture: Fixture,
  entity: AIChatMessageEntity | null,
  overrides?: Partial<GeneratedImageReferenceServiceDeps> & {
    prepareDataUrl?: string;
  }
): Harness {
  let prepareCalls = 0;
  const deps: GeneratedImageReferenceServiceDeps = {
    getSourceMessage: async (conversationId, messageId) =>
      entity &&
      conversationId === fixture.conversationId &&
      messageId === fixture.messageId
        ? entity
        : null,
    getCurrentUserEmail: () => fixture.email,
    getUserDataPath: () => fixture.userDataPath,
    realpath: fsPromises.realpath,
    openForRead: fdPinnedOpenForRead(),
    prepareImage: async () => {
      prepareCalls += 1;
      return cannedPrepared(overrides?.prepareDataUrl);
    },
    ...overrides,
  };
  return {
    service: new GeneratedImageReferenceService(deps),
    get prepareCalls(): number {
      return prepareCalls;
    },
  };
}

function ref(
  messageId: string,
  imageIndex: number
): ChatV2GeneratedImageReference {
  return { messageId, imageIndex };
}

const VALID_INPUT = (fixture: Fixture) => ({
  conversationId: fixture.conversationId,
  references: [ref(fixture.messageId, 0)],
  detail: "auto" as const,
});

function expectReferenceError(
  err: unknown,
  code: GeneratedImageReferenceErrorCode
): void {
  expect(err).toBeInstanceOf(GeneratedImageReferenceError);
  expect((err as GeneratedImageReferenceError).code).toBe(code);
}

function assertNoSensitiveLeak(err: unknown, fixture: Fixture): void {
  const text = `${String((err as Error)?.message)} ${String((err as Error)?.stack ?? "")}`;
  expect(text).not.toContain(fixture.tmpRoot);
  expect(text).not.toContain(fixture.userDataPath);
  expect(text).not.toContain("data:");
  expect(text.toLowerCase()).not.toContain("base64");
}

describe("GeneratedImageReferenceService.resolveGeneratedImages", () => {
  it("resolves a valid current-user reference end-to-end", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    const result = await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    expect(result.artifacts).toHaveLength(1);
    expect(result.metadata).toHaveLength(1);
    expect(result.artifacts[0].reference).toEqual(ref(fixture.messageId, 0));
    expect(result.artifacts[0].fileName).toBe("image-1.png");
    expect(result.artifacts[0].mimeType).toBe("image/png");
    expect(result.artifacts[0].dataUrl).toBe("data:image/png;base64,QUJD");
    expect(result.artifacts[0].detail).toBe("auto");
    expect(result.totalPreparedBytes).toBe(3);
    expect(result.totalDataUrlChars).toBe("data:image/png;base64,QUJD".length);
    expect(result.metadata[0]).toEqual({
      messageId: fixture.messageId,
      imageIndex: 0,
      fileName: "image-1.png",
      protocolUrl: expect.stringContaining(`${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://${AI_CHAT_GENERATED_IMAGE_HOST}/`),
    });
    expect(harness.prepareCalls).toBe(1);
  });

  it("rejects with generated_image_missing when the source message does not exist", async () => {
    const fixture = await makeFixture();
    const harness = makeService(fixture, null);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_missing");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects with generated_image_missing when conversation lookup misses", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages({
        conversationId: "v2-other-conversation",
        references: [ref(fixture.messageId, 0)],
        detail: "auto",
      });
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_missing");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects non-assistant role messages with generated_image_not_owned", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    entity.role = "user";
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_not_owned");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects non-MESSAGE messageType rows with generated_image_not_owned", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    entity.messageType = MessageType.TOOL_CALL;
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_not_owned");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects malformed metadata JSON with generated_image_reference_invalid", async () => {
    const fixture = await makeFixture();
    const harness = makeService(fixture, makeEntity(fixture, "{not-json"));
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_reference_invalid");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects out-of-range imageIndex with generated_image_reference_invalid", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages({
        conversationId: fixture.conversationId,
        references: [ref(fixture.messageId, 9)],
        detail: "auto",
      });
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_reference_invalid");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects wrong protocol scheme/host with generated_image_reference_invalid", async () => {
    const fixture = await makeFixture();
    const badMetadata = JSON.stringify({
      generatedImages: [
        { url: `https://${AI_CHAT_GENERATED_IMAGE_HOST}/${fixture.email}/${fixture.conversationId}/${fixture.messageId}/image-1.png` },
      ],
    });
    const harness = makeService(fixture, makeEntity(fixture, badMetadata));
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_reference_invalid");
    assertNoSensitiveLeak(caught, fixture);

    const wrongHost = JSON.stringify({
      generatedImages: [
        {
          url: `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://evil/${fixture.email}/${fixture.conversationId}/${fixture.messageId}/image-1.png`,
        },
      ],
    });
    const harness2 = makeService(fixture, makeEntity(fixture, wrongHost));
    let caught2: unknown;
    try {
      await harness2.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught2 = err;
    }
    expectReferenceError(caught2, "generated_image_reference_invalid");
    assertNoSensitiveLeak(caught2, fixture);
  });

  it("rejects a URL owned by another user with generated_image_not_owned", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata("attacker@example.com", fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_not_owned");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects mismatched conversation segment with generated_image_not_owned", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, "v2-someone-else", fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_not_owned");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects mismatched message segment with generated_image_not_owned", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, "assistant-999", "image-1.png")
    );
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_not_owned");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects an encoded %2F separator URL with generated_image_reference_invalid", async () => {
    const fixture = await makeFixture();
    const rawUrl = `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://${AI_CHAT_GENERATED_IMAGE_HOST}/${fixture.email}/v2-conv1%2Fx/${fixture.messageId}/image-1.png`;
    const metadata = JSON.stringify({
      generatedImages: [{ url: rawUrl, file_name: "image-1.png" }],
    });
    const harness = makeService(fixture, makeEntity(fixture, metadata));
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_reference_invalid");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects a symlinked file with generated_image_symlink_rejected", async () => {
    const fixture = await makeFixture();
    const targetPath = path.join(path.dirname(fixture.filePath), "target.png");
    await fsPromises.writeFile(targetPath, PNG_1X1);
    await fsPromises.unlink(fixture.filePath);
    await fsPromises.symlink(targetPath, fixture.filePath);
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_symlink_rejected");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects a directory in place of the file with generated_image_symlink_rejected", async () => {
    const fixture = await makeFixture();
    await fsPromises.rm(fixture.filePath);
    await fsPromises.mkdir(fixture.filePath);
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_symlink_rejected");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects when realpath escapes the store with generated_image_outside_store", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const messagePart = sanitizeGeneratedImagePathPart(fixture.messageId);
    const escapingRealpath = async (p: import("node:fs").PathLike): Promise<string> => {
      const candidate = p.toString();
      return candidate.endsWith(messagePart)
        ? path.join(fixture.tmpRoot, "outside", messagePart)
        : candidate;
    };
    const harness = makeService(fixture, entity, {
      realpath: escapingRealpath as unknown as typeof fsPromises.realpath,
    });
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_outside_store");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects invalid signature bytes with generated_image_unsupported_type", async () => {
    const fixture = await makeFixture();
    await fsPromises.writeFile(fixture.filePath, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_unsupported_type");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("rejects oversize files with generated_image_too_large before reading", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    let readCalled = false;
    const oversizedOpenForRead = async (): Promise<OpenedReadFile> => ({
      stats: makeFakeStats({ size: 21 * 1024 * 1024 }),
      read: async () => {
        readCalled = true;
        return PNG_1X1;
      },
      close: async () => undefined,
    });
    const harness = makeService(fixture, entity, { openForRead: oversizedOpenForRead });
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_too_large");
    expect(readCalled).toBe(false);
    assertNoSensitiveLeak(caught, fixture);
  });

  it("throws an abort-named error for a pre-aborted signal", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    const controller = new AbortController();
    controller.abort();
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages({
        ...VALID_INPUT(fixture),
        signal: controller.signal,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).name).toBe("AbortError");
    expectReferenceError(caught, "generated_image_reference_invalid");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("dedupes duplicate references first-wins preserving order", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const harness = makeService(fixture, entity);
    const result = await harness.service.resolveGeneratedImages({
      conversationId: fixture.conversationId,
      references: [
        ref(fixture.messageId, 0),
        ref(fixture.messageId, 0),
        ref(fixture.messageId, 1),
        ref(fixture.messageId, 0),
      ],
      detail: "high",
    });
    expect(harness.prepareCalls).toBe(2);
    expect(result.artifacts.map((a) => a.reference.imageIndex)).toEqual([0, 1]);
    expect(result.artifacts[0].detail).toBe("high");
  });

  it("enforces the combined total data-url char budget after the loop", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const bigDataUrl = `data:image/png;base64,${"A".repeat(3_500_000)}`;
    const harness = makeService(fixture, entity, { prepareDataUrl: bigDataUrl });
    let caught: unknown;
    try {
      await harness.service.resolveGeneratedImages({
        conversationId: fixture.conversationId,
        references: [ref(fixture.messageId, 0), ref(fixture.messageId, 1)],
        detail: "auto",
      });
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_too_large");
    assertNoSensitiveLeak(caught, fixture);
  });

  it("falls back to identity fileName when descriptor lacks file_name", async () => {
    const fixture = await makeFixture();
    const url = buildGeneratedImageProtocolUrl({
      userEmail: fixture.email,
      conversationId: fixture.conversationId,
      messageId: fixture.messageId,
      fileName: "image-1.png",
    });
    const metadata = JSON.stringify({ generatedImages: [{ url }] });
    const harness = makeService(fixture, makeEntity(fixture, metadata));
    const result = await harness.service.resolveGeneratedImages(VALID_INPUT(fixture));
    expect(result.artifacts[0].fileName).toBe("image-1.png");
    expect(result.metadata[0].fileName).toBe("image-1.png");
  });
});

describe("GeneratedImageReferenceService.authorizeOnly", () => {
  it("returns authorized sources without reading or preparing bytes", async () => {
    const fixture = await makeFixture();
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    let openCalls = 0;
    const deps: GeneratedImageReferenceServiceDeps = {
      getSourceMessage: async () => entity,
      getCurrentUserEmail: () => fixture.email,
      getUserDataPath: () => fixture.userDataPath,
      realpath: fsPromises.realpath,
      openForRead: async () => {
        openCalls += 1;
        throw new Error("must not be opened by authorizeOnly");
      },
      prepareImage: async () => {
        throw new Error("must not be prepared by authorizeOnly");
      },
    };
    const service = new GeneratedImageReferenceService(deps);
    const sources = await service.authorizeOnly({
      conversationId: fixture.conversationId,
      references: [ref(fixture.messageId, 0), ref(fixture.messageId, 0), ref(fixture.messageId, 1)],
    });
    expect(openCalls).toBe(0);
    expect(sources).toHaveLength(2);
    const realPath = await fsPromises.realpath(fixture.filePath);
    expect(sources[0].absolutePath).toBe(realPath);
    expect(sources[0].conversationId).toBe(fixture.conversationId);
    expect(sources[0].sourceMessageId).toBe(fixture.messageId);
    expect(sources[0].fileName).toBe("image-1.png");
    expect(sources[0].protocolUrl).toContain(AI_CHAT_GENERATED_IMAGE_PROTOCOL);
    expect(sources[0].reference).toEqual(ref(fixture.messageId, 0));
    expect(sources[1].reference).toEqual(ref(fixture.messageId, 1));
  });

  it("still rejects symlinks without opening the file", async () => {
    const fixture = await makeFixture();
    const targetPath = path.join(path.dirname(fixture.filePath), "target.png");
    await fsPromises.writeFile(targetPath, PNG_1X1);
    await fsPromises.unlink(fixture.filePath);
    await fsPromises.symlink(targetPath, fixture.filePath);
    const entity = makeEntity(
      fixture,
      descriptorMetadata(fixture.email, fixture.conversationId, fixture.messageId, "image-1.png")
    );
    const service = new GeneratedImageReferenceService({
      getSourceMessage: async () => entity,
      getCurrentUserEmail: () => fixture.email,
      getUserDataPath: () => fixture.userDataPath,
      realpath: fsPromises.realpath,
      openForRead: fdPinnedOpenForRead(),
      prepareImage: async () => cannedPrepared(),
    });
    let caught: unknown;
    try {
      await service.authorizeOnly({
        conversationId: fixture.conversationId,
        references: [ref(fixture.messageId, 0)],
      });
    } catch (err) {
      caught = err;
    }
    expectReferenceError(caught, "generated_image_symlink_rejected");
    assertNoSensitiveLeak(caught, fixture);
  });
});
