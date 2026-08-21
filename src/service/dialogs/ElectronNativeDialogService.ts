/**
 * Production {@link NativeDialogService} backed by Electron's `dialog`.
 *
 * Thin adapter: maps the narrow application option shape onto Electron's dialog
 * API and normalizes the return into {@link DialogResult} / {@link MessageBoxResult}.
 */

import { dialog } from "electron";
import type {
  DialogResult,
  MessageBoxOptions,
  MessageBoxResult,
  NativeDialogService,
  OpenDialogOptions,
  SaveDialogOptions,
} from "./NativeDialogService";

function normalize(canceled: boolean, filePaths: string[]): DialogResult {
  return canceled
    ? { canceled: true, filePaths }
    : { canceled: false, filePaths };
}

export class ElectronNativeDialogService implements NativeDialogService {
  async showOpenDialog(options: OpenDialogOptions): Promise<DialogResult> {
    const result = await dialog.showOpenDialog({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters
        ? options.filters.map((f) => ({
            name: f.name,
            extensions: [...f.extensions],
          }))
        : undefined,
      properties: options.properties
        ? ([...options.properties] as ("openFile" | "openDirectory" | "multiSelections")[])
        : undefined,
      buttonLabel: options.buttonLabel,
    });
    return normalize(result.canceled, result.filePaths ?? []);
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<DialogResult> {
    const result = await dialog.showSaveDialog({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters
        ? options.filters.map((f) => ({
            name: f.name,
            extensions: [...f.extensions],
          }))
        : undefined,
      buttonLabel: options.buttonLabel,
    });
    return normalize(result.canceled, result.filePath ? [result.filePath] : []);
  }

  async showMessageBox(
    options: MessageBoxOptions
  ): Promise<MessageBoxResult> {
    const result = await dialog.showMessageBox({
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: options.buttons ? [...options.buttons] : undefined,
      type: options.type,
    });
    return { response: result.response, checkboxChecked: result.checkboxChecked };
  }
}
