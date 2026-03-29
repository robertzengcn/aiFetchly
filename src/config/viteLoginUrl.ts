/**
 * Resolves the marketing / login base URL for the main process.
 * CI maps secret `VITE_LOGIN_URL_TEST` → `.env` key `VITE_LOGIN_URL`; local `.env`
 * sometimes only defines `VITE_LOGIN_URL_TEST` — we accept both via Vite-inlined `import.meta.env`.
 */

export type ViteLoginResolvedSource =
  | "process.env.VITE_LOGIN_URL"
  | "import.meta.env.VITE_LOGIN_URL"
  | "import.meta.env.VITE_LOGIN_URL_TEST";

export type ViteLoginResolved = {
  value: string;
  source: ViteLoginResolvedSource;
};

/**
 * Trim, strip UTF-8 BOM, and remove a single pair of surrounding ASCII quotes
 * so `.env` / editor quirks do not break `new URL()`.
 */
export function normalizeViteLoginUrlString(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "");
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s
      .slice(1, -1)
      .trim()
      .replace(/^\uFEFF/, "");
  }
  return s;
}

/**
 * Prefer `process.env`, then Vite-inlined `import.meta.env` (both names).
 * Empty and whitespace-only values are treated as missing.
 */
export function resolveViteLoginBase(): ViteLoginResolved | undefined {
  const meta =
    typeof import.meta !== "undefined" && import.meta.env
      ? import.meta.env
      : undefined;

  const candidates: ReadonlyArray<{
    v: string | undefined;
    source: ViteLoginResolvedSource;
  }> = [
    { v: process.env.VITE_LOGIN_URL, source: "process.env.VITE_LOGIN_URL" },
    {
      v: meta?.VITE_LOGIN_URL as string | undefined,
      source: "import.meta.env.VITE_LOGIN_URL",
    },
    {
      v: meta?.VITE_LOGIN_URL_TEST as string | undefined,
      source: "import.meta.env.VITE_LOGIN_URL_TEST",
    },
  ];

  for (const { v, source } of candidates) {
    if (typeof v !== "string") continue;
    const t = normalizeViteLoginUrlString(v);
    if (t.length > 0) {
      return { value: t, source };
    }
  }
  return undefined;
}
