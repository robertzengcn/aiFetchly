import * as path from 'path';
import * as fs from 'fs';

export interface AppInfo {
  name: string;
  version: string;
  description: string;
  author: string;
}

export class AppInfoModule {
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
          name: packageData.name || 'social-marketing',
          version: packageData.version || '1.0.0',
          description: packageData.description || 'A software for social marketing',
          author: packageData.author || 'Robert Zeng'
        };
      }
    } catch (error) {
      console.error('Error loading package.json:', error);
    }

    // Fallback values
    return {
      name: 'social-marketing',
      version: '1.0.0',
      description: 'A software for social marketing',
      author: 'Robert Zeng'
    };
  }

  public getAppInfo(): AppInfo {
    return this.appInfo;
  }

  public getAppName(): string {
    return this.appInfo.name;
  }

  public getAppVersion(): string {
    return this.appInfo.version;
  }
} 