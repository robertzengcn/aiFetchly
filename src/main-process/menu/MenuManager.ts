import { Menu, app, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Menu Manager for Session Recording Control
 * 
 * Provides application menu with session recording toggle and management options
 */
export class MenuManager {
    private isRecordingEnabled: boolean = false;
    private sessionsDirectory: string;

    constructor() {
        // Get sessions directory path
        this.sessionsDirectory = path.join(app.getPath('userData'), 'sessions');
        
        // Load recording preference from user settings
        this.loadRecordingPreference();
    }

    /**
     * Create the main application menu
     */
    createMenu(): Menu {
        const template: Electron.MenuItemConstructorOptions[] = [
            {
                label: 'File',
                submenu: [
                    {
                        label: 'Quit',
                        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                        click: () => {
                            app.quit();
                        }
                    }
                ]
            },
            {
                label: 'Session Recording',
                submenu: [
                    {
                        label: 'Enable Recording',
                        type: 'checkbox',
                        checked: this.isRecordingEnabled,
                        click: () => this.toggleRecording()
                    },
                    { type: 'separator' },
                    {
                        label: 'View Sessions Folder',
                        click: () => this.openSessionsFolder()
                    },
                    {
                        label: 'Session Recording Settings',
                        click: () => this.openRecordingSettings()
                    }
                ]
            },
            {
                label: 'Help',
                submenu: [
                    {
                        label: 'About',
                        click: () => this.showAbout()
                    }
                ]
            }
        ];

        // Add platform-specific menu items
        if (process.platform === 'darwin') {
            template.unshift({
                label: app.getName(),
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            });
        }

        return Menu.buildFromTemplate(template);
    }

    /**
     * Toggle session recording on/off
     */
    toggleRecording(): void {
        this.isRecordingEnabled = !this.isRecordingEnabled;
        this.saveRecordingPreference();
        
        console.log(`Session recording ${this.isRecordingEnabled ? 'enabled' : 'disabled'}`);
        
        // Update menu item
        this.updateMenu();
        
        // Notify main process about recording state change
        this.notifyRecordingStateChange();
    }

    /**
     * Open sessions folder in file explorer
     */
    openSessionsFolder(): void {
        try {
            // Ensure sessions directory exists
            if (!fs.existsSync(this.sessionsDirectory)) {
                fs.mkdirSync(this.sessionsDirectory, { recursive: true });
            }
            
            // Open folder in default file manager
            shell.openPath(this.sessionsDirectory);
            console.log(`Opened sessions folder: ${this.sessionsDirectory}`);
        } catch (error) {
            console.error('Failed to open sessions folder:', error);
        }
    }

    /**
     * Open recording settings (placeholder for future implementation)
     */
    openRecordingSettings(): void {
        console.log('Opening session recording settings...');
        // TODO: Implement settings dialog
        // This could open a modal window with recording configuration options
    }

    /**
     * Show about dialog
     */
    showAbout(): void {
        console.log('Showing about dialog...');
        // TODO: Implement about dialog
    }

    /**
     * Update menu to reflect current recording state
     */
    private updateMenu(): void {
        // Recreate menu with updated state
        const menu = this.createMenu();
        Menu.setApplicationMenu(menu);
    }

    /**
     * Load recording preference from user settings
     */
    private loadRecordingPreference(): void {
        try {
            const userDataPath = app.getPath('userData');
            const configPath = path.join(userDataPath, 'session-recording-config.json');
            
            if (fs.existsSync(configPath)) {
                const configData = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(configData);
                this.isRecordingEnabled = config.enabled || false;
                console.log(`Loaded recording preference: ${this.isRecordingEnabled}`);
            } else {
                // Default to disabled
                this.isRecordingEnabled = false;
                console.log('No recording preference found, defaulting to disabled');
            }
        } catch (error) {
            console.error('Failed to load recording preference:', error);
            this.isRecordingEnabled = false;
        }
    }

    /**
     * Save recording preference to user settings
     */
    private saveRecordingPreference(): void {
        try {
            const userDataPath = app.getPath('userData');
            const configPath = path.join(userDataPath, 'session-recording-config.json');
            
            const config = {
                enabled: this.isRecordingEnabled,
                lastUpdated: new Date().toISOString(),
                sessionsDirectory: this.sessionsDirectory
            };
            
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            console.log(`Saved recording preference: ${this.isRecordingEnabled}`);
        } catch (error) {
            console.error('Failed to save recording preference:', error);
        }
    }

    /**
     * Notify main process about recording state change
     */
    private notifyRecordingStateChange(): void {
        // This will be used to communicate with the main process
        // and potentially other parts of the application
        console.log(`Recording state changed: ${this.isRecordingEnabled}`);
        
        // TODO: Implement IPC communication to notify main process
        // and update global recording state
    }

    /**
     * Get current recording status
     */
    getRecordingStatus(): boolean {
        return this.isRecordingEnabled;
    }

    /**
     * Set recording status programmatically
     */
    setRecordingStatus(enabled: boolean): void {
        this.isRecordingEnabled = enabled;
        this.saveRecordingPreference();
        this.updateMenu();
        this.notifyRecordingStateChange();
    }

    /**
     * Get sessions directory path
     */
    getSessionsDirectory(): string {
        return this.sessionsDirectory;
    }
}
