import { app } from "electron";
import fs from "fs/promises";
import path from "path";
import type { OpenAIChatImage } from "@/api/aiChatApi";
import { USEREMAIL } from "@/config/usersetting";
import { Token } from "@/modules/token";
import {
  AI_CHAT_GENERATED_IMAGE_PROTOCOL,
  buildGeneratedImageProtocolUrl,
  getGeneratedImageUserRoot,
  normalizeGeneratedImageUserEmail,
  parseGeneratedImageProtocolIdentity,
  sanitizeGeneratedImagePathPart,
} from "@/service/AIChatGeneratedImageProtocol";

type FetchLike = typeof fetch;

const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_EXTENSION: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface StoreGeneratedImagesInput {
  conversationId: string;
  messageId: string;
  images: OpenAIChatImage[];
}

export interface RehomeImagesInput {
  images: OpenAIChatImage[];
  targetConversationId: string;
  targetMessageId: string;
}

/**
 * Stores AI-generated remote images under Electron userData so chat history
 * does not depend on provider URLs that expire.
 */
export class AIChatGeneratedImageStorageService {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly userDataPath: string = app.getPath("userData"),
    private readonly currentUserEmail: string = readCurrentUserEmail()
  ) {}

  async storeImages(
    input: StoreGeneratedImagesInput
  ): Promise<OpenAIChatImage[]> {
    if (input.images.length === 0) {
      return [];
    }
    const storedImages: OpenAIChatImage[] = [];
    for (let index = 0; index < input.images.length; index += 1) {
      const image = input.images[index];
      try {
        storedImages.push(await this.storeImage(input, image, index));
      } catch (err) {
        console.warn(
          `[ai-chat-v2] failed to store generated image locally for conversation ${input.conversationId}:`,
          err
        );
        storedImages.push(image);
      }
    }
    return storedImages;
  }

  /**
   * Re-homes descriptors persisted under a foreign identity (e.g. a sub-agent
   * conversation `agent-v2-*` / message `agent-assistant-*`) into the target
   * (parent) conversation + assistant-message identity so parent-conversation
   * authorization can resolve them later.
   *
   * Per descriptor:
   *  - non-protocol URLs pass through untouched;
   *  - protocol URLs owned by a DIFFERENT local user pass through untouched
   *    (never read or copied — re-homing only touches the current user's own
   *    store);
   *  - protocol URLs already matching the target identity pass through
   *    untouched (idempotent for direct completions);
   *  - otherwise the source file is COPIED (never moved) into the target
   *    directory using storeImage's `image-<n>` naming and the descriptor is
   *    rewritten with the new protocol URL + local_path.
   *
   * Never throws: a missing/unreadable source returns the original descriptor.
   */
  async rehomeImages(input: RehomeImagesInput): Promise<OpenAIChatImage[]> {
    if (input.images.length === 0) {
      return [];
    }
    const targetConversation = sanitizeGeneratedImagePathPart(
      input.targetConversationId
    );
    const targetMessage = sanitizeGeneratedImagePathPart(
      input.targetMessageId
    );
    const directory = path.join(
      getGeneratedImageUserRoot(this.userDataPath, this.currentUserEmail),
      targetConversation,
      targetMessage
    );
    const rehomedImages: OpenAIChatImage[] = [];
    for (let index = 0; index < input.images.length; index += 1) {
      rehomedImages.push(
        await this.rehomeImage(input.images[index], index, {
          directory,
          conversationPathPart: targetConversation,
          messagePathPart: targetMessage,
        })
      );
    }
    return rehomedImages;
  }

  private async rehomeImage(
    image: OpenAIChatImage,
    index: number,
    target: {
      directory: string;
      conversationPathPart: string;
      messagePathPart: string;
    }
  ): Promise<OpenAIChatImage> {
    if (!image.url) {
      return image;
    }
    const identity = parseGeneratedImageProtocolIdentity(
      image.url,
      this.userDataPath
    );
    if (!identity) {
      return image;
    }
    // Ownership guard: a descriptor may name ANOTHER local user's folder
    // (the parser normalizes any user segment). Never read or copy another
    // user's generated image — pass the descriptor through unchanged.
    if (
      identity.normalizedUser !==
      normalizeGeneratedImageUserEmail(this.currentUserEmail)
    ) {
      return image;
    }
    if (
      identity.conversationPathPart === target.conversationPathPart &&
      identity.messagePathPart === target.messagePathPart
    ) {
      return image;
    }
    try {
      await fs.mkdir(target.directory, { recursive: true });
      const extension = path.extname(identity.fileName) || ".png";
      const fileName = `image-${index + 1}${extension}`;
      const filePath = path.join(target.directory, fileName);
      // Copy (not move): the agent-owned original stays intact for its own
      // transcript; overwriting an existing destination keeps repeat calls
      // idempotent.
      await fs.copyFile(identity.candidatePath, filePath);
      return {
        ...image,
        delivery: "local_file",
        url: buildGeneratedImageProtocolUrl({
          userEmail: this.currentUserEmail,
          conversationId: target.conversationPathPart,
          messageId: target.messagePathPart,
          fileName,
        }),
        local_path: filePath,
        file_name: fileName,
        download_required: false,
        b64_json: undefined,
      };
    } catch (err) {
      console.warn(
        `[ai-chat-v2] failed to re-home generated image into conversation ${target.conversationPathPart}:`,
        err
      );
      return image;
    }
  }

  private async storeImage(
    input: StoreGeneratedImagesInput,
    image: OpenAIChatImage,
    index: number
  ): Promise<OpenAIChatImage> {
    if (
      image.url?.startsWith("file://") ||
      image.url?.startsWith(`${AI_CHAT_GENERATED_IMAGE_PROTOCOL}:`)
    ) {
      return image;
    }
    const buffer = image.b64_json
      ? Buffer.from(image.b64_json, "base64")
      : await this.downloadImage(image);
    if (buffer.length === 0) {
      return image;
    }
    if (buffer.length > MAX_GENERATED_IMAGE_BYTES) {
      throw new Error("Generated image exceeds local storage size limit.");
    }

    const mimeType = this.resolveMimeType(image);
    const extension = MIME_EXTENSION[mimeType] ?? "png";
    const conversationPathPart = sanitizeGeneratedImagePathPart(
      input.conversationId
    );
    const messagePathPart = sanitizeGeneratedImagePathPart(input.messageId);
    const directory = path.join(
      getGeneratedImageUserRoot(this.userDataPath, this.currentUserEmail),
      conversationPathPart,
      messagePathPart
    );
    await fs.mkdir(directory, { recursive: true });
    const fileName = `image-${index + 1}.${extension}`;
    const filePath = path.join(directory, fileName);
    await fs.writeFile(filePath, buffer);

    return {
      ...image,
      delivery: "local_file",
      url: buildGeneratedImageProtocolUrl({
        userEmail: this.currentUserEmail,
        conversationId: conversationPathPart,
        messageId: messagePathPart,
        fileName,
      }),
      original_url: image.original_url ?? image.url,
      local_path: filePath,
      file_name: fileName,
      mime_type: mimeType,
      download_required: false,
      b64_json: undefined,
    };
  }

  private async downloadImage(image: OpenAIChatImage): Promise<Buffer> {
    if (!image.url || !isHttpUrl(image.url)) {
      return Buffer.alloc(0);
    }
    const response = await this.fetchImpl(image.url);
    if (!response.ok) {
      throw new Error(`Image download failed with HTTP ${response.status}.`);
    }
    const responseMimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (
      responseMimeType &&
      !responseMimeType.startsWith("image/") &&
      !image.mime_type?.startsWith("image/")
    ) {
      throw new Error(`Unexpected generated image MIME type: ${responseMimeType}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private resolveMimeType(image: OpenAIChatImage): string {
    if (image.mime_type?.startsWith("image/")) {
      return normalizeMimeType(image.mime_type);
    }
    if (image.url) {
      let extension = "";
      try {
        extension = path.extname(new URL(image.url).pathname).toLowerCase();
      } catch {
        extension = "";
      }
      if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
      if (extension === ".webp") return "image/webp";
      if (extension === ".gif") return "image/gif";
      if (extension === ".png") return "image/png";
    }
    return "image/png";
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase() === "image/jpg" ? "image/jpeg" : mimeType;
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function readCurrentUserEmail(): string {
  const tokenService = new Token();
  return tokenService.getValue(USEREMAIL);
}
