/**
 * E2E native-dialog adapter (design §11.2).
 *
 * Substitutes {@link NativeDialogService} when AIFETCHLY_E2E=1. It returns ONLY
 * predefined responses read from the validated state manifest — never opening a
 * real OS dialog (which cannot be automated through DOM interaction). Returned
 * paths must stay inside the E2E root; a missing configured response fails
 * closed rather than prompting the OS.
 *
 * Wiring into individual IPC handlers is incremental (design §11.2); this class
 * is the contract those handlers depend on once migrated.
 */

import * as path from "path";
import type {
  DialogResult,
  MessageBoxOptions,
  MessageBoxResult,
  NativeDialogService,
  OpenDialogOptions,
  SaveDialogOptions,
} from "@/service/dialogs/NativeDialogService";
import { parseStateManifest, type E2EEnvironment } from "./E2EEnvironment";

export type E2EDialogKind = "open" | "save" | "message";

function isContainedBy(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

export class E2ENativeDialogService implements NativeDialogService {
  private readonly responses: Record<
    string,
    { action: string; paths?: string[] }
  > | null;

  constructor(
    private readonly environment: E2EEnvironment,
    stateFilePath: string
  ) {
    try {
      this.responses = (parseStateManifest(stateFilePath).dialogResponses ??
        null) as unknown as Record<
        string,
        { action: string; paths?: string[] }
      > | null;
    } catch {
      this.responses = null;
    }
  }

  private resolve(kind: E2EDialogKind): {
    action: "canceled" | "confirmed";
    paths: readonly string[];
  } {
    const entry = this.responses?.[kind];
    if (!entry) {
      throw new Error(
        `E2E native dialog "${kind}" was invoked but no response is configured in state.json`
      );
    }
    const action = entry.action === "confirmed" ? "confirmed" : "canceled";
    const paths = (entry.paths ?? []).filter((p) =>
      isContainedBy(this.environment.rootPath, p)
    );
    return { action, paths };
  }

  async showOpenDialog(_options: OpenDialogOptions): Promise<DialogResult> {
    return this.toFileResult(this.resolve("open"));
  }

  async showSaveDialog(_options: SaveDialogOptions): Promise<DialogResult> {
    return this.toFileResult(this.resolve("save"));
  }

  async showMessageBox(_options: MessageBoxOptions): Promise<MessageBoxResult> {
    // Message boxes have no file paths; the action alone determines the result.
    const r = this.resolve("message");
    return {
      response: r.action === "confirmed" ? 0 : 1,
      checkboxChecked: false,
    };
  }

  private toFileResult(r: {
    action: string;
    paths: readonly string[];
  }): DialogResult {
    // A confirmed file dialog with no in-root paths is downgraded to canceled
    // so a misconfigured manifest can never surface an out-of-root path.
    const confirmed = r.action === "confirmed" && r.paths.length > 0;
    return confirmed
      ? { canceled: false, filePaths: r.paths }
      : { canceled: true, filePaths: [] };
  }
}
