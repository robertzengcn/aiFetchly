export interface GoogleMapsWorkerExitDetails {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

function summarizeOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return "<empty>";
  return trimmed.slice(-4000);
}

export function formatGoogleMapsWorkerExitDiagnostic(
  details: GoogleMapsWorkerExitDetails
): string {
  return [
    `code=${String(details.code)}`,
    `signal=${String(details.signal)}`,
    `stderr=${summarizeOutput(details.stderr)}`,
    `stdout=${summarizeOutput(details.stdout)}`,
  ].join("; ");
}
