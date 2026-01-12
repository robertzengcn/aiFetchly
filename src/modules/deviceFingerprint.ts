"use strict";
import { machineIdSync } from 'node-machine-id';
import * as os from 'os';
import { Token } from '@/modules/token';
import { DEVICEIDHASH } from '@/config/usersetting';

export class DeviceFingerprintService {
    private tokenService: Token;

    constructor() {
        this.tokenService = new Token();
    }

    /**
     * Get unique device identifier using node-machine-id
     * Returns stored deviceIdHash if available, otherwise generates and stores a new one
     */
    public getDeviceIdHash(): string {
        // Try to get stored deviceIdHash first
        const storedHash = this.getStoredDeviceIdHash();
        if (storedHash && storedHash.length > 0) {
            return storedHash;
        }

        // Generate new device ID using node-machine-id
        const deviceId = machineIdSync();
        
        // Store it for future use
        this.storeDeviceIdHash(deviceId);
        
        return deviceId;
    }

    /**
     * Get system-generated device name
     * Format: "aiFetchly - {Platform} {Version}"
     */
    public getDeviceName(): string {
        const platform = os.platform();
        const release = os.release();
        
        let platformName = '';
        switch (platform) {
            case 'win32':
                platformName = 'Windows';
                break;
            case 'darwin':
                platformName = 'macOS';
                break;
            case 'linux':
                platformName = 'Linux';
                break;
            default:
                platformName = platform;
        }

        return `aiFetchly - ${platformName} ${release}`;
    }

    /**
     * Retrieve previously stored deviceIdHash
     */
    public getStoredDeviceIdHash(): string {
        try {
            const hash = this.tokenService.getValue(DEVICEIDHASH);
            return hash || '';
        } catch (error) {
            console.error('Failed to get stored deviceIdHash:', error);
            return '';
        }
    }

    /**
     * Store deviceIdHash for reuse across app sessions
     */
    public storeDeviceIdHash(hash: string): void {
        try {
            if (hash && hash.length > 0) {
                this.tokenService.setValue(DEVICEIDHASH, hash);
            }
        } catch (error) {
            console.error('Failed to store deviceIdHash:', error);
        }
    }
}





