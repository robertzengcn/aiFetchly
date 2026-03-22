/**
 * Validates CSV / batch-import proxy rows: host, port, and protocol are required.
 */
export type ProxyRequiredField = "host" | "port" | "protocol";

export function getMissingProxyFields(
  host: string | undefined,
  port: string | undefined,
  protocol: string | undefined
): ProxyRequiredField[] {
  const missing: ProxyRequiredField[] = [];
  if (!(host ?? "").trim()) {
    missing.push("host");
  }
  if (!(port ?? "").trim()) {
    missing.push("port");
  }
  if (!(protocol ?? "").trim()) {
    missing.push("protocol");
  }
  return missing;
}

/** True if the row has no meaningful content (blank CSV line). */
export function isBlankProxyCsvRow(
  host: string | undefined,
  port: string | undefined,
  protocol: string | undefined,
  user: string | undefined,
  pass: string | undefined
): boolean {
  return (
    !(host ?? "").trim() &&
    !(port ?? "").trim() &&
    !(protocol ?? "").trim() &&
    !(user ?? "").trim() &&
    !(pass ?? "").trim()
  );
}

export interface InvalidProxyRowInfo {
  /** 1-based data row index within the CSV (excluding header). */
  dataRowIndex: number;
  missing: ProxyRequiredField[];
}
