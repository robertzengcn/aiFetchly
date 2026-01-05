"use strict";
import { HttpClient } from "@/modules/lib/httpclient";
import { CommonApiresp } from "@/entityTypes/commonType";

/**
 * Device registration response data interface
 */
export interface DeviceRegistrationData {
    success: boolean;
    deviceId: number;
    message: string;
}

/**
 * Device registration request interface
 */
export interface DeviceRegistrationRequest {
    deviceName: string;
    deviceIdHash: string;
    refreshToken?: string;
}

/**
 * API client for device registration
 * 
 * Handles device registration with the Go backend after user login.
 * Associates the device fingerprint with the user's account and refresh token.
 * 
 * @example
 * ```typescript
 * const api = new DeviceApi();
 * const result = await api.registerDevice('aiFetchly - Windows 10', 'device-hash-123', 'refresh-token');
 * if (result.status && result.data) {
 *   console.log('Device registered:', result.data.deviceId);
 * }
 * ```
 */
export class DeviceApi {
    private _httpClient: HttpClient;

    /**
     * Creates a new DeviceApi instance
     * Initializes the HTTP client for remote communication
     */
    constructor() {
        this._httpClient = new HttpClient();
    }

    /**
     * Registers or updates device information for the authenticated user
     * 
     * @param deviceName - User-friendly device name (e.g., "aiFetchly - Windows 10")
     * @param deviceIdHash - Unique device identifier/hash from Electron app
     * @param refreshToken - Optional refresh token to associate with device
     * @returns Promise resolving to device registration response
     * @throws {Error} When network request fails or validation errors occur
     * 
     * @example
     * ```typescript
     * const result = await api.registerDevice(
     *   'aiFetchly - Windows 10',
     *   'abc123def456',
     *   'refresh-token-here'
     * );
     * ```
     */
    async registerDevice(
        deviceName: string,
        deviceIdHash: string,
        refreshToken?: string
    ): Promise<CommonApiresp<DeviceRegistrationData>> {
        if (!deviceIdHash || deviceIdHash.trim().length === 0) {
            throw new Error('deviceIdHash is required');
        }

        const requestBody: DeviceRegistrationRequest = {
            deviceName: deviceName || 'aiFetchly Device',
            deviceIdHash: deviceIdHash.trim(),
        };

        // Add refresh token if provided
        if (refreshToken && refreshToken.trim().length > 0) {
            requestBody.refreshToken = refreshToken.trim();
        }

        try {
            const response = await this._httpClient.postJson(
                '/api/auth/device',
                requestBody
            );

            // Handle API response errors
            if (!response.status) {
                // Check for specific error codes
                if (response.code === 401) {
                    throw new Error('Invalid or expired access token');
                } else if (response.code === 400) {
                    throw new Error(response.msg || 'Bad request');
                } else {
                    throw new Error(response.msg || 'Device registration failed');
                }
            }

            return response;
        } catch (error) {
            // Re-throw with more context
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(`Device registration failed: ${String(error)}`);
        }
    }
}


