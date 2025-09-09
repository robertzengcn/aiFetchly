import { 
    LoginStateError, 
    createAuthRequiredError, 
    createSessionExpiredError,
    createInvalidStateError,
    createPermissionDeniedError
} from '@/mcp-server/types/mcpTypes';
import { UserController } from '@/controller/UserController';

/**
 * Login state validation utility for MCP server
 * Provides functions to validate user authentication and application state
 */
export class LoginStateValidator {
    private userController: UserController;

    constructor() {
        this.userController = new UserController();
    }

    /**
     * Validate that the user is authenticated
     * @param action The action being attempted
     * @returns Promise<LoginStateError | null> - Returns error if validation fails, null if successful
     */
    public async validateAuthentication(action: string): Promise<LoginStateError | null> {
        try {
            // Check if user is logged in
            const userInfo = await this.userController.checklogin();
            
            if (!userInfo) {
                const loginUrl = this.userController.getLoginPageUrl();
                return createAuthRequiredError(action, loginUrl);
            }

            // Check if session is still valid (you might want to add additional checks here)
            if (!userInfo.email || !userInfo.name) {
                return createSessionExpiredError();
            }

            return null; // Authentication is valid
        } catch (error) {
            console.error('Error validating authentication:', error);
            const loginUrl = this.userController.getLoginPageUrl();
            return createAuthRequiredError(action, loginUrl);
        }
    }

    /**
     * Validate that the user has the required permissions
     * @param action The action being attempted
     * @param requiredPermission The required permission level
     * @returns Promise<LoginStateError | null> - Returns error if validation fails, null if successful
     */
    public async validatePermission(
        action: string, 
        requiredPermission: string = 'user'
    ): Promise<LoginStateError | null> {
        try {
            // First check authentication
            const authError = await this.validateAuthentication(action);
            if (authError) {
                return authError;
            }

            // Get user info to check permissions
            const userInfo = this.userController.getUserInfo();
            
            // For now, we'll implement basic permission checking
            // You can extend this based on your user roles/permissions system
            if (requiredPermission === 'admin' && !this.hasAdminRole(userInfo)) {
                return createPermissionDeniedError(action, 'admin');
            }

            return null; // Permission is valid
        } catch (error) {
            console.error('Error validating permission:', error);
            return createPermissionDeniedError(action, requiredPermission);
        }
    }

    /**
     * Validate that the application is in the required state
     * @param action The action being attempted
     * @param requiredState The required application state
     * @param currentState The current application state
     * @returns LoginStateError | null - Returns error if validation fails, null if successful
     */
    public validateApplicationState(
        action: string,
        requiredState: string,
        currentState: string
    ): LoginStateError | null {
        if (currentState !== requiredState) {
            return createInvalidStateError(currentState, requiredState, action);
        }

        return null; // State is valid
    }

    /**
     * Check if user has admin role
     * @param userInfo User information object
     * @returns boolean - True if user has admin role
     */
    private hasAdminRole(userInfo: any): boolean {
        // This is a placeholder implementation
        // You should implement this based on your actual user roles system
        return userInfo.roles && userInfo.roles.includes('admin');
    }

    /**
     * Get current user state for validation
     * @returns Promise<object> - Current user state information
     */
    public async getCurrentUserState(): Promise<{
        isAuthenticated: boolean;
        userInfo?: any;
        loginUrl?: string;
    }> {
        try {
            const userInfo = await this.userController.checklogin();
            const loginUrl = this.userController.getLoginPageUrl();
            
            return {
                isAuthenticated: !!userInfo,
                userInfo: userInfo || undefined,
                loginUrl
            };
        } catch (error) {
            console.error('Error getting current user state:', error);
            return {
                isAuthenticated: false,
                loginUrl: this.userController.getLoginPageUrl()
            };
        }
    }
}

/**
 * Singleton instance of LoginStateValidator
 */
export const loginStateValidator = new LoginStateValidator();
