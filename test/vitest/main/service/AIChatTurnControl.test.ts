import { describe, expect, it, vi } from "vitest";
import {
  AIChatTurnControl,
  type AIChatSteeringInstruction,
} from "@/service/AIChatTurnControl";

function makeInstruction(
  pendingMessageId: string,
  text = "focus on Europe"
): AIChatSteeringInstruction {
  return {
    pendingMessageId,
    clientRequestId: `cr-${pendingMessageId}`,
    displayContent: text,
    modelContent: text,
    createdAt: new Date().toISOString(),
    targetAssistantMessageId: "assistant-1",
  };
}

describe("AIChatTurnControl two-phase reservation", () => {
  it("reserves, commits, and drains in creation order", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const control = new AIChatTurnControl(persist, "assistant-1");

    const r1 = control.reserve("pm-1");
    const r2 = control.reserve("pm-2");
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();

    expect(control.commit(r1!, makeInstruction("pm-1"))).toBe(true);
    expect(control.commit(r2!, makeInstruction("pm-2"))).toBe(true);
    expect(control.hasPending()).toBe(true);

    const batch = await control.consume("after_tool");
    expect(batch?.boundary).toBe("after_tool");
    expect(batch?.instructions.map((i) => i.pendingMessageId)).toEqual([
      "pm-1",
      "pm-2",
    ]);
    // Each instruction was persisted BEFORE being returned.
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[0][0].instruction.pendingMessageId).toBe("pm-1");
    expect(persist.mock.calls[0][0].boundary).toBe("after_tool");

    expect(control.hasPending()).toBe(false);
    // A second consume with nothing committed returns null.
    expect(await control.consume("before_model")).toBeNull();
  });

  it("rejects a duplicate reservation for the same pending message", () => {
    const control = new AIChatTurnControl(vi.fn(), "assistant-1");
    const first = control.reserve("pm-dup");
    expect(first).not.toBeNull();
    expect(control.reserve("pm-dup")).toBeNull();
  });

  it("commit returns false after close — caller must restore the DB row", () => {
    const control = new AIChatTurnControl(vi.fn(), "assistant-1");
    const reservation = control.reserve("pm-closed");
    expect(reservation).not.toBeNull();
    control.close();
    expect(control.commit(reservation!, makeInstruction("pm-closed"))).toBe(
      false
    );
    expect(control.reserve("pm-other")).toBeNull();
    expect(control.isClosed).toBe(true);
  });

  it("commit rejects unknown reservations", () => {
    const control = new AIChatTurnControl(vi.fn(), "assistant-1");
    const reservation = control.reserve("pm-x");
    control.cancelReservation(reservation!.reservationId);
    expect(control.commit(reservation!, makeInstruction("pm-x"))).toBe(false);
  });

  it("consume persists instructions one-by-one; a failure keeps earlier ones applied", async () => {
    const persist = vi.fn().mockImplementation(async ({ instruction }) => {
      if (instruction.pendingMessageId === "pm-bad") {
        throw new Error("db locked");
      }
    });
    const control = new AIChatTurnControl(persist, "assistant-1");
    for (const id of ["pm-1", "pm-bad", "pm-3"]) {
      const r = control.reserve(id);
      expect(r).not.toBeNull();
      expect(control.commit(r!, makeInstruction(id))).toBe(true);
    }

    await expect(control.consume("before_tool")).rejects.toThrow("db locked");
    expect(persist).toHaveBeenCalledTimes(2); // pm-1 ok, pm-bad threw
  });

  it("caps a single consume at 10 instructions", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const control = new AIChatTurnControl(persist, "assistant-1");
    for (let i = 0; i < 12; i += 1) {
      const r = control.reserve(`pm-${i}`);
      expect(control.commit(r!, makeInstruction(`pm-${i}`))).toBe(true);
    }
    const first = await control.consume("after_model");
    expect(first?.instructions.length).toBe(10);
    expect(control.hasPending()).toBe(true);
    const second = await control.consume("after_model");
    expect(second?.instructions.length).toBe(2);
  });
});
