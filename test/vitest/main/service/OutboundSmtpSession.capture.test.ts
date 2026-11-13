import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import net from "net";
import { OutboundSmtpSession } from "@/modules/lib/smtpTransport";
import { createOutboundSenderFactory } from "@/service/emailOrganization/EmailForwardDeliveryService";
import type { SenderParam } from "@/service/emailOrganization/EmailForwardDeliveryService";

/**
 * R5-02 regression: the PRODUCTION sender factory must return the raw
 * composed MIME the successful SMTP attempt actually submitted. The bytes
 * come from the session's stream plugin (nodemailer's SMTP result does NOT
 * populate `info.message`), and the TLS-retry transporter must carry the
 * same capture plugin — otherwise the successful attempt submits bytes
 * nobody captured.
 */

function makeParam(): SenderParam {
  return {
    id: 1,
    from: "ops@example.test",
    password: "secret",
    host: "smtp.example.test",
    port: "587",
    name: "Ops",
    ssl: 0,
    smtpUsername: null,
    replyTo: null,
  } as unknown as SenderParam;
}

function jsonTransporter(): Transporter {
  // jsonTransport compiles the full MIME (the stream stage runs) without
  // touching the network — info.message carries the JSON-serialized body.
  return nodemailer.createTransport({ jsonTransport: true });
}

describe("R5-02 — production SMTP session raw capture", () => {
  it("captures the compiled MIME through the stream plugin and the factory returns it", async () => {
    const session = new OutboundSmtpSession(makeParam() as never, {
      transporterFactory: () => jsonTransporter(),
    });
    const info = await session.sendMail({
      from: "ops@example.test",
      to: "finance@example.test",
      subject: "Fwd: test",
      text: "hello body",
    });
    expect(String((info as { message?: string }).message ?? "")).toContain("hello body");
    const captured = session.capturedRawMessage();
    expect(captured).not.toBeNull();
    expect(captured!.length).toBeGreaterThan(0);
    expect(captured!.toString("utf8")).toContain("hello body");
    session.close();
  });

  it("a fresh send never observes the previous attempt's bytes", async () => {
    const session = new OutboundSmtpSession(makeParam() as never, {
      transporterFactory: () => jsonTransporter(),
    });
    await session.sendMail({ from: "a@b.test", to: "c@d.test", subject: "one", text: "first body" });
    expect(session.capturedRawMessage()!.toString("utf8")).toContain("first body");
    await session.sendMail({ from: "a@b.test", to: "c@d.test", subject: "two", text: "second body" });
    const captured = session.capturedRawMessage()!;
    expect(captured.toString("utf8")).toContain("second body");
    expect(captured.toString("utf8")).not.toContain("first body");
    session.close();
  });

  it("the TLS-retry transporter installs the same capture plugin", async () => {
    const builtModes: string[] = [];
    let firstCall = true;
    const session = new OutboundSmtpSession(
      {
        id: 1,
        from: "ops@example.test",
        password: "secret",
        host: "smtp.example.test",
        port: "465",
        name: "Ops",
        ssl: 1,
        smtpUsername: null,
        replyTo: null,
      } as unknown as SenderParam,
      {
        transporterFactory: (mode) => {
          builtModes.push(mode);
          if (firstCall) {
            firstCall = false;
            // First transporter fails the TLS handshake the way an
            // implicit-TLS/STARTTLS mismatch does (secure=true + 465).
            const failing = jsonTransporter();
            const originalSend = failing.sendMail.bind(failing);
            failing.sendMail = (async (options: unknown) => {
              const error = new Error("WRONG_VERSION_NUMBER");
              throw error;
            }) as typeof failing.sendMail;
            void originalSend;
            return failing;
          }
          return jsonTransporter();
        },
      }
    );
    const info = await session.sendMail({
      from: "ops@example.test",
      to: "finance@example.test",
      subject: "retry",
      text: "retry body",
    });
    expect(builtModes).toEqual(["configured", "starttls"]);
    expect(String((info as { message?: string }).message ?? "")).toContain("retry body");
    // R5-02: the bytes captured are the SUCCESSFUL attempt's — the retry
    // transporter carried the plugin, so capture did not miss the send.
    expect(session.capturedRawMessage()!.toString("utf8")).toContain("retry body");
    session.close();
  });

  it("the PRODUCTION factory submits to a loopback SMTP server and returns the exact submitted bytes as raw", async () => {
    const commands: string[] = [];
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 loopback ESMTP\r\n");
      let dataMode = false;
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        for (;;) {
          const lineEnd = buffer.indexOf("\r\n");
          if (lineEnd === -1) return;
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 2);
          if (dataMode) {
            if (line === ".") {
              dataMode = false;
              socket.write("250 OK queued as LOOP1\r\n");
            }
            continue;
          }
          commands.push(line);
          const verb = line.slice(0, 4).toUpperCase();
          if (verb === "EHLO" || verb === "HELO") {
            socket.write("250-loopback\r\n250 8BITMIME\r\n");
          } else if (verb === "MAIL" || verb === "RCPT") {
            socket.write("250 OK\r\n");
          } else if (verb === "DATA") {
            dataMode = true;
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (verb === "QUIT") {
            socket.write("221 Bye\r\n");
            socket.end();
            return;
          } else {
            socket.write("250 OK\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const param = {
      id: 1,
      from: "ops@example.test",
      password: "not-needed",
      host: "127.0.0.1",
      port: String(address.port),
      name: "Ops",
      ssl: 0,
      smtpUsername: null,
      replyTo: null,
    } as unknown as SenderParam;
    const factory = createOutboundSenderFactory();
    const sender = factory(param);
    const result = await sender.sendMail({
      from: "ops@example.test",
      to: ["finance@example.test"],
      subject: "loopback capture",
      text: "exact submitted bytes",
    });
    expect(result.accepted).toEqual(["finance@example.test"]);
    // R5-02: `raw` carries the exact MIME the socket received — not nodemailer's
    // unset info.message.
    expect(result.raw).not.toBeNull();
    const raw = result.raw!.toString("utf8");
    expect(raw).toContain("Subject: loopback capture");
    expect(raw).toContain("exact submitted bytes");
    expect(commands.some((line) => line.toUpperCase().startsWith("MAIL FROM"))).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
