import { Token } from '@/modules/token';
import { UserController } from '@/controller/UserController';
import { EventEmitter } from 'events';
import { TOKENNAME } from '@/config/usersetting';

/**
 * Login State Monitor for MCP Server
 * 
 * Monitors and validates the current login state of the user.
 * This ensures that MCP tools can only be used when the user is properly authenticated.
 */
export class LoginStateMonitor extends EventEmitter {
    private token: Token;
    private userController: UserController;
    private lastCheckTime: number = 0;
    private cachedLoginState: boolean | null = null;
    private readonly CACHE_DURATION = 30000; // 30 seconds cache
    private lastKnownState: boolean | null = null;
    
    constructor() {
        super();
        this.token = new Token();
        this.userController = new UserController();
        
        // Start monitoring login state changes
        this.startMonitoring();
    }
    
    /**
     * Start monitoring login state changes
     */
    private startMonitoring(): void {
        // Check login state every 5 seconds
        setInterval(async () => {
            await this.checkLoginStateChange();
        }, 5000);
        
        // Initial check
        this.checkLoginStateChange();
    }
    
    /**
     * Check for login state changes and emit events
     */
    private async checkLoginStateChange(): Promise<void> {
        const currentState = await this.isLoggedIn();
        
        // Only emit event if state has changed
        if (this.lastKnownState !== null && this.lastKnownState !== currentState) {
            const user = currentState ? await this.getCurrentUser() : null;
            
            this.emit('loginStateChanged', {
                isLoggedIn: currentState,
                user: user,
                timestamp: new Date().toISOString()
            });
            
            console.log(`Login state changed: ${this.lastKnownState} -> ${currentState}`);
        }
        
        this.lastKnownState = currentState;
    }
    
    /**
     * Check if the user is currently logged in
     * Uses caching to avoid frequent checks
     */
    public async isLoggedIn(): Promise<boolean> {
        const now = Date.now();
        
        // Return cached result if still valid
        if (this.cachedLoginState !== null && (now - this.lastCheckTime) < this.CACHE_DURATION) {
            return this.cachedLoginState;
        }
        
        try {
            // Check if token exists and is valid
            const tokenExists = this.token.getValue(TOKENNAME);
            if (!tokenExists) {
                this.cachedLoginState = false;
                this.lastCheckTime = now;
                return false;
            }
            
            // Verify token with user controller
            const isValid = await this.verifyTokenWithUserController();
            
            this.cachedLoginState = isValid;
            this.lastCheckTime = now;
            
            return isValid;
        } catch (error) {
            console.error('Error checking login state:', error);
            this.cachedLoginState = false;
            this.lastCheckTime = now;
            return false;
        }
    }
    
    /**
     * Verify token with user controller
     */
    private async verifyTokenWithUserController(): Promise<boolean> {
        try {
            // This would typically make a call to verify the token
            // For now, we'll assume the token is valid if it exists
            const token = this.token.getValue(TOKENNAME);
            return token !== null && token !== '';
        } catch (error) {
            console.error('Error verifying token with user controller:', error);
            return false;
        }
    }
    
    /**
     * Force refresh of login state (bypass cache)
     */
    public async refreshLoginState(): Promise<boolean> {
        this.cachedLoginState = null;
        this.lastCheckTime = 0;
        return await this.isLoggedIn();
    }
    
    /**
     * Get current user information if logged in
     */
    public async getCurrentUser(): Promise<any | null> {
        const isLoggedIn = await this.isLoggedIn();
        if (!isLoggedIn) {
            return null;
        }
        
        try {
            // This would typically get user information from the user controller
            // For now, return a basic user object
            return {
                id: 'current_user',
                email: 'user@example.com',
                logged_in: true,
                last_check: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting current user:', error);
            return null;
        }
    }
    
    /**
     * Clear cached login state
     */
    public clearCache(): void {
        this.cachedLoginState = null;
        this.lastCheckTime = 0;
    }
    
    /**
     * Get login state information for debugging
     */
    public getLoginStateInfo(): any {
        return {
            cached_state: this.cachedLoginState,
            last_check_time: this.lastCheckTime,
            cache_duration: this.CACHE_DURATION,
            cache_valid: this.cachedLoginState !== null && (Date.now() - this.lastCheckTime) < this.CACHE_DURATION
        };
    }
}
