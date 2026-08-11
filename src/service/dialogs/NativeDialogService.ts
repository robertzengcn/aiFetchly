/**
 * Native dialog abstraction (design §11).
 *
 * A narrow application service rather than Electron's full `dialog` object, so
 * IPC handlers depend on an interface that can be substituted in E2E tests.
 * Production uses {@link ElectronNativeDialogService}; the E2E bootstrap can
 * install {@link E2ENativeDialogService} which returns only validated,
 * manifest-configured responses (never opening a real OS dialog).
 *
 * Introduced incrementally (design §11.2): new dialog call sites should depend
 * on this interface; existing call sites are migrated as they are touched.
 */

/** Result of an open/save dialog that was canceled. */
export interface DialogCanceledResult {
  readonly canceled: true;
  readonly filePaths: readonly string[];
}

/** Result of an open/save dialog that was confirmed. */
export interface DialogConfirmedResult {
  readonly canceled: false;
  readonly filePaths: readonly string[];
}

export type DialogResult = DialogCanceledResult | DialogConfirmedResult;

export interface MessageBoxResult {
  readonly response: number;
  readonly checkboxChecked: boolean;
}

/** Minimal option shape (callers adapt from their own UI context). */
export interface OpenDialogOptions {
  readonly title?: string;
  readonly defaultPath?: string;
  readonly filters?: ReadonlyArray<{
    readonly name: string;
    readonly extensions: readonly string[];
  }>;
  readonly properties?: readonly string[];
  readonly buttonLabel?: string;
}

export interface SaveDialogOptions {
  readonly title?: string;
  readonly defaultPath?: string;
  readonly filters?: ReadonlyArray<{
    readonly name: string;
    readonly extensions: readonly string[];
  }>;
  readonly buttonLabel?: string;
}

export interface MessageBoxOptions {
  readonly title?: string;
  readonly message: string;
  readonly detail?: string;
  readonly buttons?: readonly string[];
  readonly type?: "none" | "info" | "error" | "question" | "warning";
}

export interface NativeDialogService {
  showOpenDialog(options: OpenDialogOptions): Promise<DialogResult>;
  showSaveDialog(options: SaveDialogOptions): Promise<DialogResult>;
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxResult>;
}
