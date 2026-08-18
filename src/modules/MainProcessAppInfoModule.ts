import { app } from "electron";
import { log } from "@/modules/Logger";
import * as path from "path";
import * as fs from "fs";
import { AppInfo } from "@/modules/AppInfoModule";

export class MainProcessAppInfoModule {
  private appInfo: AppInfo;

  constructor() {
    this.appInfo = this.loadAppInfo();
  }

  private loadAppInfo(): AppInfo {
    // Version MUST come from Electron's app.getVersion(): it is the value the
    // packaged build reports and the one the update feed compares SemVer
    // against. Reading it from process.cwd()/package.json is unreliable in
    // packaged builds (PRD §2.3), so version is always authoritative from app.
    const version = app.getVersion() || "1.0.0";

    // name/description/author are display-only metadata; package.json is a fine
    // source when present, with safe Electron-derived fallbacks.
    let name = app.getName() || "social-marketing";
    let description = "A software for social marketing";
    let author = "Robert Zeng";

    try {
      const packagePath = path.join(process.cwd(), "package.json");
      if (fs.existsSync(packagePath)) {
        const packageData = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        name = packageData.name || name;
        description = packageData.description || description;
        author = packageData.author || author;
      }
    } catch (error) {
      log.error("Error loading package.json:", error);
    }

    return { name, version, description, author };
  }

  private formatAppName(name: string): string {
    // Convert kebab-case to Title Case
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  public getAppInfo(): AppInfo {
    return this.appInfo;
  }

  public getAppName(): string {
    return this.formatAppName(this.appInfo.name);
  }

  public getAppVersion(): string {
    return this.appInfo.version;
  }

  public getRawAppName(): string {
    return this.appInfo.name;
  }
}
