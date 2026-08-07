import { z } from "zod/v4";
import {
  PASTED_TEXT_MAX_BLOCKS_PER_MESSAGE,
  PASTED_TEXT_MAX_TOTAL_EXPANDED_CHARS,
} from "@/service/pastedText/PastedTextLimits";

// Note: send-time request validation only.
// The main process is still expected to do enforcement and expansion.

const pasteIdField = z
  .string()
  .regex(/^\d+$/)
  .transform((s) => s); // keep as string keys at the boundary

const pastedValueField = z.string().max(PASTED_TEXT_MAX_TOTAL_EXPANDED_CHARS);

export const aiChatV2PastedContentsSchema = z
  .record(pasteIdField, pastedValueField)
  .refine(
    (obj) => Object.keys(obj).length <= PASTED_TEXT_MAX_BLOCKS_PER_MESSAGE,
    {
      message: "too many pasted blocks",
    }
  )
  .refine(
    (obj) => {
      const total = Object.values(obj).reduce((acc, v) => acc + v.length, 0);
      return total <= PASTED_TEXT_MAX_TOTAL_EXPANDED_CHARS;
    },
    {
      message: "pastedContents total size exceeds limit",
    }
  );

export type AiChatV2PastedContents = z.infer<
  typeof aiChatV2PastedContentsSchema
>;
