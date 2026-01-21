"use strict";
// NOTE: This service intentionally does NOT import HttpClient to avoid circular dependency.
// HttpClient uses TokenRefreshService for token refresh, so TokenRefreshService uses raw fetch() instead.
import { Token } from "@/modules/token";
import { TOKENNAME, REFRESHTOKEN } from "@/config/usersetting";
import { User } from "@/modules/user";
import { CommonApiresp } from "@/entityTypes/commonType";

/**
 * Token refresh response data interface
 */
export interface TokenRefreshData {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

/**
 * Service for refreshing access tokens using refresh tokens
 * 
 * Handles automatic token refresh when access tokens expire.
 * Updates stored tokens after successful refresh and handles errors appropriately.
 * 
 * NOTE: This service uses raw fetch() instead of HttpClient to avoid circular dependency.
 * HttpClient depends on TokenRefreshService for automatic token refresh.
 * 
 * @example
 * ```typescript
 * const service = new TokenRefreshService();
 * try {
 *   const result = await service.refreshAccessToken();
 *   if (result.status && result.data) {
 *     console.log('Token refreshed, expires in:', result.data.expiresIn);
 *   }
 * } catch (error) {
 *   console.error('Token refresh failed:', error);
 * }
 * ```
 */
export class TokenRefreshService {
    private _baseUrl: string;
    private _tokenService: Token;
    private _userService: User;
    private _isRefreshing = false;

    constructor() {
        // Use process.env for environment variables in Electron main process
        // NOTE: Removed import.meta.env check - Vite statically replaces import.meta.env.VITE_*
        // at build time which causes Invalid URL errors in Electron main process.
        // process.env is loaded correctly via Vite's loadEnv() in vite.main.config.mjs
        let loginUrl: string | undefined = process.env.VITE_LOGIN_URL;

        // Validate and ensure we have a valid URL
        if (!loginUrl || loginUrl.trim() === '') {
            loginUrl = 'http://localhost:3000';
        }

        // Validate URL format
        try {
            new URL(loginUrl);
        } catch (error) {
            console.warn(`Invalid VITE_LOGIN_URL: ${loginUrl}, falling back to default`);
            loginUrl = 'http://localhost:3000';
        }

        this._baseUrl = loginUrl + "/apis";
        this._tokenService = new Token();
        this._userService = new User();
    }

    /**
     * Refreshes the access token using the stored refresh token
     * 
     * Uses raw fetch() to avoid circular dependency with HttpClient.
     * 
     * @returns Promise resolving to token refresh response with new tokens
     * @throws {Error} When refresh token is missing, invalid, or expired
     * 
     * @example
     * ```typescript
     * const result = await service.refreshAccessToken();
     * ```
     */
    async refreshAccessToken(): Promise<CommonApiresp<TokenRefreshData>> {
        // Prevent concurrent refresh requests
        if (this._isRefreshing) {
            throw new Error('Token refresh already in progress');
        }

        this._isRefreshing = true;

        try {
            // Get refresh token from storage
            const refreshToken = this._tokenService.getValue(REFRESHTOKEN);
            
            if (!refreshToken || refreshToken.trim().length === 0) {
                throw new Error('Refresh token not found');
            }

            // Call refresh API endpoint using raw fetch (to avoid circular dependency with HttpClient)
            const requestBody = {
                refreshToken: refreshToken.trim()
            };

            const res = await fetch(this._baseUrl + '/api/auth/refresh', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!res.ok) {
                throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
            }

            const response: CommonApiresp<TokenRefreshData> = await res.json();

            // Handle API response errors
            if (!response.status) {
                // Check for specific error codes
                if (response.code === 401) {
                    const errorMsg = response.msg || 'Invalid or expired refresh token';
                    
                    // Sign out user on authentication failure
                    try {
                        await this._userService.Signout();
                    } catch (signoutError) {
                        console.error('Error during signout:', signoutError);
                    }
                    
                    throw new Error(errorMsg);
                } else {
                    throw new Error(response.msg || 'Token refresh failed');
                }
            }

            // Update stored tokens if refresh was successful
            if (response.data) {
                this._tokenService.setValue(TOKENNAME, response.data.accessToken);
                
                // Handle refresh token rotation (backend may return new refresh token)
                if (response.data.refreshToken && response.data.refreshToken.trim().length > 0) {
                    this._tokenService.setValue(REFRESHTOKEN, response.data.refreshToken);
                }
            }

            return response;
        } catch (error) {
            // Re-throw with more context
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(`Token refresh failed: ${String(error)}`);
        } finally {
            this._isRefreshing = false;
        }
    }

    /**
     * Check if a token refresh is currently in progress
     * 
     * @returns boolean indicating if refresh is in progress
     */
    isRefreshing(): boolean {
        return this._isRefreshing;
    }
}
