import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AppInfo } from '@/modules/AppInfoModule';

export class MainProcessAppInfoModule {
  private appInfo: AppInfo;

  constructor() {
    this.appInfo = this.loadAppInfo();
  }

  private loadAppInfo(): AppInfo {
    try {
      // Try to read from package.json
      const packagePath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(packagePath)) {
        const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return {
          name: packageData.name || app.getName() || 'social-marketing',
          version: packageData.version || app.getVersion() || '1.0.0',
          description: packageData.description || 'A software for social marketing',
          author: packageData.author || 'Robert Zeng'
        };
      }
    } catch (error) {
      console.error('Error loading package.json:', error);
    }

    // Fallback to Electron app info
    return {
      name: app.getName() || 'social-marketing',
      version: app.getVersion() || '1.0.0',
      description: 'A software for social marketing',
      author: 'Robert Zeng'
    };
  }

  private formatAppName(name: string): string {
    // Convert kebab-case to Title Case
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
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