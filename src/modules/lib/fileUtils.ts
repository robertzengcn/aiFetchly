import * as fs from "fs";
import * as path from "path";
import fetch from "node-fetch";

/**
 * File-system utilities — extracted from lib/function.ts (R5.6).
 */
export async function checkFolderAndGetFiles(
  folderPath: string
): Promise<string[]> {
  try {
    // Check if the folder exists
    const folderExists = await fs.promises
      .stat(folderPath)
      .then((stat) => stat.isDirectory())
      .catch(() => false);

    if (!folderExists) {
      // console.log(`Folder does not exist: ${folderPath}`);
      return [];
    }

    // Read the contents of the folder
    const files = await fs.promises.readdir(folderPath);
    return files;
  } catch (error) {
    // console.error(`Error checking folder or reading files: ${error.message}`);
    return [];
  }
}
/**
 * Download a file from a remote URL and save it to a specified path.
 * @param url - The URL of the file to download.
 * @param savePath - The path where the file should be saved.
 * @returns A promise that resolves when the file has been downloaded and saved.
 */
export async function downloadFile(
  url: string,
  savePath: string,
  onSuccess?: () => void,
  onFailure?: (error: Error) => void
): Promise<void> {
  try {
    //defined a tmp file name
    const tmpFileName = savePath + ".tmp";
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const fileStream = fs.createWriteStream(tmpFileName);

    return new Promise((resolve, reject) => {
      if (response.body) {
        response.body.pipe(fileStream);
        response.body.on("error", (error) => {
          reject(error);
          if (onFailure) {
            onFailure(error as Error);
          }
        });
      } else {
        if (onFailure) {
          onFailure(new Error("Response body is null"));
        }

        reject(new Error("Response body is null"));
      }
      fileStream.on("finish", () => {
        //rename to tmp file to save path
        fs.rename(tmpFileName, savePath, (error) => {
          if (error) {
            reject(error);
            if (onFailure) {
              onFailure(error as Error);
            }
          } else {
            resolve();
            if (onSuccess) {
              onSuccess();
            }
          }
        });

        // resolve();
        // if (onSuccess) {
        //   onSuccess();
        // }
      });
    });
  } catch (error) {
    //remove file if download failed
    //await removeFile(savePath)
    if (onFailure) {
      onFailure(error as Error);
    }

    throw error;
  }
}

