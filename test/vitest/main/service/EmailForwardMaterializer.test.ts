import { describe, it, expect, beforeEach } from "vitest";
import {
  EmailForwardMaterializer,
  estimateComposedBytes,
} from "@/service/emailOrganization/EmailForwardMaterializer";
import type {
  EmailMailboxAdapter,
  FullSourceResult,
  MailboxCapabilityProbe,
  MailboxLocation,
  FolderListResult,
  MoveResult,
  PresenceResult,
  ServerSearchInput,
  ServerSearchResult,
} from "@/service/emailOrganization/EmailMailboxAdapter";
import type { EmailOrganizationArtifactBackend } from "@/service/emailOrganization/EmailOrganizationArtifactStore";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";

/**
 * R01/R02/R18 regression family: composed-MIME correctness must be asserted
 * on the actual materialized content, not just the manifest.
 */

class StubAdapter implements EmailMailboxAdapter {
  constructor(private source: FullSourceResult) {}
  setSource(source: FullSourceResult): void {
    this.source = source;
  }
  async listFolders() {
    return { status: "listed" as const, folders: [] };
  }
  async probeCapabilities() {
    return { moveCapability: true, folders: [], reasonCode: null, sanitizedError: null };
  }
  async fetchFullSource(_c: unknown, location: MailboxLocation): Promise<FullSourceResult> {
    const source = this.source;
    return source.status === "fetched"
      ? { status: "fetched", source: source.source, uidValidity: location.uidValidity }
      : source;
  }
  async moveMessage(): Promise<MoveResult> {
    return { status: "failed", reasonCode: "PROVIDER_REJECTED", sanitizedError: "unused" };
  }
  async checkMessagePresent(): Promise<PresenceResult> {
    return { status: "present" };
  }
  async searchUids(): Promise<ServerSearchResult> {
    return { status: "listed", candidates: [], capped: false };
  }
  async appendSent() {
    return { status: "skipped" as const, reason: "no_sent_folder" };
  }
}

class MemoryArtifacts implements EmailOrganizationArtifactBackend {
  readonly store = new Map<string, Buffer>();
  async put(content: Buffer): Promise<string> {
    const id = `art-${this.store.size + 1}`;
    this.store.set(id, Buffer.from(content));
    return id;
  }
  async get(id: string): Promise<Buffer> {
    const bytes = this.store.get(id);
    if (bytes === undefined) throw new Error("missing");
    return bytes;
  }
  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }
  async purge(id: string): Promise<void> {
    this.store.delete(id);
  }
  async purgeOlderThan(): Promise<number> {
    return 0;
  }
}

const RECEIVED_AT = "2026-09-15T10:00:00Z";
const LOCATION = { folderPath: "INBOX", uidValidity: "4242", uid: "1" };
const CONFIG = {
  emailServiceId: 1,
  protocol: "imap" as const,
  host: "h",
  port: 993,
  ssl: true,
  username: "u",
  password: "p",
  folder: "INBOX",
};

function multipartFixture(options: {
  html?: string;
  text?: string;
  inlineImage?: boolean;
  remoteImage?: boolean;
  attachment?: boolean;
}): string {
  const parts: string[] = [];
  parts.push(
    "--INNER",
    "Content-Type: text/plain; charset=utf-8",
    "",
    options.text ?? "plain body",
    "--INNER",
    "Content-Type: text/html; charset=utf-8",
    "",
    options.html ?? "<p>html body</p>"
  );
  if (options.inlineImage) {
    parts.push(
      "--INNER",
      'Content-Type: image/png; name="logo.png"',
      'Content-Disposition: inline; filename="logo.png"',
      "Content-Transfer-Encoding: base64",
      "Content-ID: <logo1>",
      "",
      "aGVsbG8gaW5saW5l"
    );
  }
  if (options.remoteImage) {
    parts.push(
      "--INNER",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>tracking <img src="https://track.example.test/pixel.gif" width="8"></p>'
    );
  }
  parts.push("--INNER--");
  if (options.attachment) {
    parts.push(
      "--OUTER",
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQK"
    );
  }
  return [
    "From: Sender One <sender@example.test>",
    "To: me@example.test",
    "Subject: Original subject line",
    `Date: Wed, 30 Sep 2026 10:00:00 +0000`,
    "Message-ID: <orig@example.test>",
    'Content-Type: multipart/mixed; boundary="OUTER"',
    "",
    "--OUTER",
    'Content-Type: multipart/alternative; boundary="INNER"',
    "",
    ...parts,
    "--OUTER--",
    "",
  ].join("\r\n");
}

const baseInput = {
  sourceMessageId: 1,
  location: LOCATION,
  receiveConfig: CONFIG,
  note: null,
  toRecipients: ["to@example.test"],
  ccRecipients: [],
  bccRecipients: [],
  subject: "Fwd: Original subject line",
  attachmentSelection: { mode: "all" } as const,
};

let materializer: EmailForwardMaterializer;
let adapter: StubAdapter;

beforeEach(() => {
  adapter = new StubAdapter({
    status: "fetched",
    source: Buffer.from(multipartFixture({}), "utf8"),
    uidValidity: "4242",
  });
  materializer = new EmailForwardMaterializer({
    adapter,
    artifactStore: new MemoryArtifacts(),
  });
});

describe("R01 — original content and headers preserved in composed output", () => {
  it("plaintext-only source: the HTML alternative carries the escaped original text (not empty)", async () => {
    adapter.setSource({
      status: "fetched",
      source: Buffer.from(
        "From: a@b.test\r\nTo: c@d.test\r\nSubject: plain\r\nDate: Wed, 30 Sep 2026 10:00:00 +0000\r\n\r\nplain body text <special>\r\n",
        "utf8"
      ),
      uidValidity: "4242",
    });
    const result = await materializer.materialize({ ...baseInput });
    expect(result.bodyHtml).toContain("plain body text &lt;special&gt;");
    expect(result.bodyHtml).toContain("Subject: plain");
    expect(result.bodyText).toContain("plain body text <special>");
  });

  it("selected inline CID image stays referenced by the forwarded HTML", async () => {
    adapter.setSource({
      status: "fetched",
      source: Buffer.from(
        multipartFixture({ html: '<p>see <img src="cid:logo1" width="40"></p>', inlineImage: true }),
        "utf8"
      ),
      uidValidity: "4242",
    });
    const result = await materializer.materialize({ ...baseInput });
    expect(result.bodyHtml).toContain('src="cid:logo1"');
    const inline = result.attachments.find((entry) => entry.disposition === "inline");
    expect(inline?.selected).toBe(true);
    expect(inline?.contentId).toBe("logo1");
  });

  it("quoted Subject reflects the ORIGINAL subject even when the outgoing subject was edited", async () => {
    const result = await materializer.materialize({
      ...baseInput,
      subject: "Fwd: completely rewritten subject",
    });
    expect(result.bodyText).toContain("Subject: Original subject line");
    expect(result.bodyText).not.toContain("Subject: Fwd: completely rewritten subject");
  });

  it("parts-mode selects a real subset and an unselected inline image is removed (review R02)", async () => {
    adapter.setSource({
      status: "fetched",
      source: Buffer.from(
        multipartFixture({
          html: '<p>x <img src="cid:logo1"></p>',
          inlineImage: true,
          attachment: true,
        }),
        "utf8"
      ),
      uidValidity: "4242",
    });
    const result = await materializer.materialize({
      ...baseInput,
      attachmentSelection: { mode: "parts", partIds: ["part-1"] }, // inline only
    });
    expect(result.bodyHtml).toContain('src="cid:logo1"');
    expect(result.attachments.find((entry) => entry.partId === "part-1")?.selected).toBe(true);
    expect(
      result.attachments.find((entry) => entry.displayName === "invoice.pdf")?.selected
    ).toBe(false);
    expect(result.selectedAttachmentCount).toBe(1);
  });

  it("an unselected inline cid image is dropped from the forwarded HTML (review)", async () => {
    adapter.setSource({
      status: "fetched",
      source: Buffer.from(
        multipartFixture({
          html: '<p>x <img src="cid:logo1"></p>',
          inlineImage: true,
        }),
        "utf8"
      ),
      uidValidity: "4242",
    });
    const result = await materializer.materialize({
      ...baseInput,
      attachmentSelection: { mode: "none" },
    });
    expect(result.bodyHtml).not.toContain("cid:logo1");
    expect(result.attachments.every((entry) => !entry.selected)).toBe(true);
  });

  it("forward sanitization strips script/handlers while keeping cid images (review XSS)", async () => {
    adapter.setSource({
      status: "fetched",
      source: Buffer.from(
        multipartFixture({
          html: '<p onclick="evil()">x</p><script>alert(1)</script><a href="javascript:alert(2)">y</a><p><img src="cid:logo1"></p>',
          inlineImage: true,
        }),
        "utf8"
      ),
      uidValidity: "4242",
    });
    const result = await materializer.materialize({ ...baseInput });
    expect(result.bodyHtml).not.toContain("alert(1)");
    expect(result.bodyHtml).not.toContain("javascript:");
    expect(result.bodyHtml).not.toContain("onclick");
    expect(result.bodyHtml).toContain("cid:logo1");
  });

  it("binds each reference to its OWN part even when bytes are identical (R5-06)", async () => {
    // Two inline parts, identical bytes, distinct CIDs (logo1/logo2).
    // Selection is per part, never per byte equality: the selected part
    // keeps its own reference; the unselected part's reference is removed
    // and disclosed — no modulo assignment by HTML occurrence order.
    const identicalB64 = "aGVsbG8gaW5saW5l";
    const source = [
      "From: a@b.test",
      "To: c@d.test",
      "Subject: dup",
      'Content-Type: multipart/mixed; boundary="OUTER"',
      "",
      "--OUTER",
      'Content-Type: multipart/alternative; boundary="INNER"',
      "",
      "--INNER",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>one <img src="cid:logo1"> two <img src="cid:logo2"></p>',
      "--INNER--",
      "--OUTER",
      'Content-Type: image/png; name="one.png"',
      'Content-Disposition: inline; filename="one.png"',
      "Content-Transfer-Encoding: base64",
      "Content-ID: <logo1>",
      "",
      identicalB64,
      "--OUTER",
      'Content-Type: image/png; name="two.png"',
      'Content-Disposition: inline; filename="two.png"',
      "Content-Transfer-Encoding: base64",
      "Content-ID: <logo2>",
      "",
      identicalB64,
      "--OUTER--",
      "",
    ].join("\r\n");
    adapter.setSource({ status: "fetched", source: Buffer.from(source, "utf8"), uidValidity: "4242" });

    // Only the FIRST part selected: logo1's own reference survives; logo2's
    // reference is removed (the part does not travel) and disclosed.
    const onlyFirst = await materializer.materialize({
      ...baseInput,
      attachmentSelection: { mode: "parts", partIds: ["part-1"] },
    });
    expect(onlyFirst.bodyHtml).toContain('src="cid:logo1"');
    expect(onlyFirst.bodyHtml).not.toContain("cid:logo2");
    expect(onlyFirst.validationFindings).toContain("unselected_inline_image_removed");

    // Only the SECOND part selected: logo2's reference survives — part
    // identity is independent of HTML order.
    const onlySecond = await materializer.materialize({
      ...baseInput,
      attachmentSelection: { mode: "parts", partIds: ["part-2"] },
    });
    expect(onlySecond.bodyHtml).toContain('src="cid:logo2"');
    expect(onlySecond.bodyHtml).not.toContain("cid:logo1");

    // Both: both references stay, each part travels.
    const both = await materializer.materialize({
      ...baseInput,
      attachmentSelection: { mode: "all" },
    });
    expect(both.bodyHtml).toContain("cid:logo1");
    expect(both.bodyHtml).toContain("cid:logo2");
    expect(both.selectedAttachmentCount).toBe(2);

    // Neither: both references removed.
    const neither = await materializer.materialize({
      ...baseInput,
      attachmentSelection: { mode: "none" },
    });
    expect(neither.bodyHtml).not.toContain("cid:logo1");
    expect(neither.bodyHtml).not.toContain("cid:logo2");
  });

  it("repeated references to one selected part all survive; reversed document order keeps identity (R5-06)", async () => {
    const b64 = "aGVsbG8gaW5saW5l";
    const source = [
      "From: a@b.test",
      "To: c@d.test",
      "Subject: repeat",
      'Content-Type: multipart/mixed; boundary="OUTER"',
      "",
      "--OUTER",
      'Content-Type: multipart/alternative; boundary="INNER"',
      "",
      "--INNER",
      "Content-Type: text/html; charset=utf-8",
      "",
      // REVERSED order: logo2 appears first in the document. A repeated
      // reference to logo1 exists too.
      '<p>a <img src="cid:logo2"> b <img src="cid:logo1"> c <img src="cid:logo1"></p>',
      "--INNER--",
      "--OUTER",
      'Content-Type: image/png; name="one.png"',
      'Content-Disposition: inline; filename="one.png"',
      "Content-Transfer-Encoding: base64",
      "Content-ID: <logo1>",
      "",
      b64,
      "--OUTER",
      'Content-Type: image/png; name="two.png"',
      'Content-Disposition: inline; filename="two.png"',
      "Content-Transfer-Encoding: base64",
      "Content-ID: <logo2>",
      "",
      b64,
      "--OUTER--",
      "",
    ].join("\r\n");
    adapter.setSource({ status: "fetched", source: Buffer.from(source, "utf8"), uidValidity: "4242" });

    // Only logo1 selected: BOTH of its references survive regardless of
    // occurrence order; the unselected logo2's single reference is removed.
    const result = await materializer.materialize({
      ...baseInput,
      attachmentSelection: { mode: "parts", partIds: ["part-1"] },
    });
    const matches = result.bodyHtml.match(/src="cid:logo1"/g) ?? [];
    expect(matches.length).toBe(2);
    expect(result.bodyHtml).not.toContain("cid:logo2");
    expect(result.attachments.find((entry) => entry.contentId === "logo1")?.selected).toBe(true);
  });

  it("remote tracking images are stripped while cid references survive sanitization", async () => {
    adapter.setSource({
      status: "fetched",
      source: Buffer.from(
        multipartFixture({
          html: '<p>x <img src="cid:logo1"> <img src="https://track.example.test/p.gif"></p>',
          inlineImage: true,
        }),
        "utf8"
      ),
      uidValidity: "4242",
    });
    const result = await materializer.materialize({ ...baseInput });
    expect(result.bodyHtml).toContain("cid:logo1");
    expect(result.bodyHtml).not.toContain("track.example.test");
    expect(result.validationFindings).toContain("remote_images_removed");
  });
});

describe("R02 — attachment selection resolves and bounds honestly", () => {
  it("refuses a nonexistent selected part id instead of silently omitting it", async () => {
    adapter.setSource({
      status: "fetched",
      source: Buffer.from(multipartFixture({ attachment: true }), "utf8"),
      uidValidity: "4242",
    });
    await expect(
      materializer.materialize({
        ...baseInput,
        attachmentSelection: { mode: "parts", partIds: ["part-99"] },
      })
    ).rejects.toMatchObject({ code: "ATTACHMENT_UNAVAILABLE" });
  });

  it("applies count/byte limits to the SELECTED parts only", async () => {
    // Source carries many large attachments; a text-only forward stays valid.
    const bigAttachments: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      bigAttachments.push(
        `--OUTER`,
        `Content-Type: application/octet-stream; name="big${i}.bin"`,
        `Content-Disposition: attachment; filename="big${i}.bin"`,
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.alloc(700 * 1024).toString("base64")
      );
    }
    const source = [
      "From: a@b.test",
      "To: c@d.test",
      "Subject: many",
      "Content-Type: multipart/mixed; boundary=\"OUTER\"",
      "",
      "--OUTER",
      "Content-Type: text/plain",
      "",
      "hello",
      ...bigAttachments,
      "--OUTER--",
      "",
    ].join("\r\n");
    adapter.setSource({ status: "fetched", source: Buffer.from(source, "utf8"), uidValidity: "4242" });

    const textOnly = await materializer.materialize({
      ...baseInput,
      attachmentSelection: { mode: "none" },
    });
    expect(textOnly.selectedAttachmentCount).toBe(0);

    const oversize = { content: Buffer.alloc(16 * 1024 * 1024) };
    expect(
      estimateComposedBytes("t", "h", [oversize])
    ).toBeGreaterThan(EMAIL_ORGANIZATION_LIMITS.maxTotalAttachmentBytes);
  });
});

describe("R18 — unsupported MIME and composed bound", () => {
  it("rejects S/MIME payload parts at nested depth", async () => {
    adapter.setSource({
      status: "fetched",
      source: Buffer.from(
        [
          "From: a@b.test",
          "To: c@d.test",
          "Subject: smime",
          "Content-Type: multipart/mixed; boundary=\"OUTER\"",
          "",
          "--OUTER",
          "Content-Type: text/plain",
          "",
          "hello",
          "--OUTER",
          "Content-Type: application/pkcs7-mime; name=smime.p7m",
          "Content-Disposition: attachment; filename=\"smime.p7m\"",
          "",
          "MIAGCSqGSIb3",
          "--OUTER--",
          "",
        ].join("\r\n"),
        "utf8"
      ),
      uidValidity: "4242",
    });
    await expect(materializer.materialize({ ...baseInput })).rejects.toMatchObject({
      code: "MIME_UNSUPPORTED",
    });
  });

  it("reports a conservative composed byte count and refuses over-bound messages", () => {
    const small = estimateComposedBytes("hello", "<p>hello</p>", [
      { content: Buffer.alloc(1000) },
    ]);
    // 4/3 expansion + overhead, strictly above raw bytes.
    expect(small).toBeGreaterThan(1000 + 10);
    const over = estimateComposedBytes("t", "h", [
      { content: Buffer.alloc(EMAIL_ORGANIZATION_LIMITS.maxComposedBytes) },
    ]);
    expect(over).toBeGreaterThan(EMAIL_ORGANIZATION_LIMITS.maxComposedBytes);
  });
});

void RECEIVED_AT;
