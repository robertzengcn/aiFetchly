// src/service/AgentOutputParser.ts

export type ParseResult =
  | { ok: true; output: Record<string, unknown> }
  | { ok: false; error: string };

export class AgentOutputParser {
  /**
   * Parse JSON from direct JSON, a fenced ```json block, or the last JSON
   * object in the text. Then validate that all `schema.required` keys exist.
   */
  parse(text: string, schema: { required?: string[] }): ParseResult {
    const trimmed = text.trim();
    const candidates: string[] = [];

    candidates.push(trimmed);

    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) {
      candidates.push(fence[1].trim());
    }

    const last = trimmed.lastIndexOf("{");
    if (last >= 0) {
      const close = trimmed.lastIndexOf("}");
      if (close > last) {
        candidates.push(trimmed.slice(last, close + 1));
      }
    }

    let parsed: Record<string, unknown> | null = null;
    let lastError = "";
    for (const c of candidates) {
      try {
        const obj = JSON.parse(c);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          parsed = obj as Record<string, unknown>;
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!parsed) {
      return {
        ok: false,
        error: `Agent output is not valid JSON. ${lastError}`.trim(),
      };
    }

    const required = schema.required ?? [];
    const missing = required.filter((k) => !(k in parsed));
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Agent output missing required fields: ${missing.join(", ")}`,
      };
    }

    return { ok: true, output: parsed };
  }
}
