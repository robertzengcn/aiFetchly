# Platform Authentication Annotations

This document explains how to annotate platform configurations to indicate authentication requirements and provide detailed authentication information.

## Overview

Platforms may require different types of authentication to access business data. The authentication annotation system allows you to specify:

- Whether authentication is required
- What type of authentication is needed
- Required credentials and form elements
- Authentication flow details
- Rate limiting and timeout information

## Authentication Types

### 1. No Authentication (`none`)
Platforms that don't require any authentication.

```typescript
authentication: {
  type: 'none',
  requiresLogin: false,
  requiresApiKey: false,
  requiresOAuth: false,
  requiresSession: false,
  requiresCookies: false,
  persistentAuth: false
}
```

### 2. User Login (`login`)
Platforms that require user account login.

```typescript
authentication: {
  type: 'login',
  requiresLogin: true,
  requiresApiKey: false,
  requiresOAuth: false,
  requiresSession: true,
  requiresCookies: true,
  loginUrl: 'https://example.com/login',
  logoutUrl: 'https://example.com/logout',
  loginForm: {
    usernameInput: '#username',
    passwordInput: '#password',
    loginButton: '.login-button',
    formContainer: '.login-form'
  },
  authStatus: {
    loggedInIndicator: '.user-menu',
    loggedOutIndicator: '.login-link'
  },
  requiredCredentials: ['username', 'password'],
  persistentAuth: true,
  authTimeout: 3600000, // 1 hour
  requiresReauth: false,
  authRateLimit: 5
}
```

### 3. API Key (`api_key`)
Platforms that require an API key for access.

```typescript
authentication: {
  type: 'api_key',
  requiresLogin: false,
  requiresApiKey: true,
  requiresOAuth: false,
  requiresSession: false,
  requiresCookies: false,
  requiredCredentials: ['api_key'],
  persistentAuth: true,
  authTimeout: 0, // No timeout
  requiresReauth: false,
  authRateLimit: 1000
}
```

### 4. OAuth (`oauth`)
Platforms that use OAuth for authentication.

```typescript
authentication: {
  type: 'oauth',
  requiresLogin: true,
  requiresApiKey: false,
  requiresOAuth: true,
  requiresSession: true,
  requiresCookies: true,
  loginUrl: 'https://oauth.example.com/authorize',
  logoutUrl: 'https://oauth.example.com/logout',
  requiredCredentials: ['client_id', 'client_secret', 'redirect_uri'],
  persistentAuth: true,
  authTimeout: 3600000,
  requiresReauth: true,
  authRateLimit: 10
}
```

### 5. Session-based (`session`)
Platforms that use session-based authentication.

```typescript
authentication: {
  type: 'session',
  requiresLogin: true,
  requiresApiKey: false,
  requiresOAuth: false,
  requiresSession: true,
  requiresCookies: true,
  loginUrl: 'https://example.com/login',
  logoutUrl: 'https://example.com/logout',
  loginForm: {
    usernameInput: '#username',
    passwordInput: '#password',
    loginButton: '.login-button'
  },
  requiredCredentials: ['username', 'password'],
  persistentAuth: false,
  authTimeout: 1800000, // 30 minutes
  requiresReauth: true,
  authRateLimit: 10
}
```

### 6. Cookie-based (`cookie`)
Platforms that rely on cookies for authentication.

```typescript
authentication: {
  type: 'cookie',
  requiresLogin: true,
  requiresApiKey: false,
  requiresOAuth: false,
  requiresSession: false,
  requiresCookies: true,
  loginUrl: 'https://example.com/login',
  logoutUrl: 'https://example.com/logout',
  loginForm: {
    usernameInput: '#username',
    passwordInput: '#password',
    loginButton: '.login-button'
  },
  requiredCredentials: ['username', 'password'],
  persistentAuth: true,
  authTimeout: 86400000, // 24 hours
  requiresReauth: false,
  authRateLimit: 5
}
```

## Configuration Fields

### Basic Authentication Fields

- **`type`**: The primary authentication method
- **`requiresLogin`**: Whether user login is required
- **`requiresApiKey`**: Whether an API key is required
- **`requiresOAuth`**: Whether OAuth is required
- **`requiresSession`**: Whether session management is required
- **`requiresCookies`**: Whether cookies are required

### Login Configuration

- **`loginUrl`**: URL for the login page
- **`logoutUrl`**: URL for the logout page
- **`loginForm`**: CSS selectors for login form elements
- **`authStatus`**: Selectors for checking authentication status

### Credential Management

- **`requiredCredentials`**: Array of required credential field names
- **`persistentAuth`**: Whether authentication persists across sessions
- **`authTimeout`**: Authentication timeout in milliseconds
- **`requiresReauth`**: Whether re-authentication is required
- **`authRateLimit`**: Rate limiting for authentication attempts

## Login Form Selectors

```typescript
loginForm: {
  usernameInput: '#username',           // Username/email input field
  passwordInput: '#password',           // Password input field
  emailInput: '#email',                 // Email input field (alternative)
  loginButton: '.login-button',         // Login/submit button
  formContainer: '.login-form',         // Login form container
  captchaSelector: '.captcha-container', // CAPTCHA element
  rememberMeCheckbox: '#remember-me'    // Remember me checkbox
}
```

## Authentication Status Selectors

```typescript
authStatus: {
  loggedInIndicator: '.user-menu',      // Element visible when logged in
  loggedOutIndicator: '.login-link',    // Element visible when logged out
  userMenuSelector: '.user-dropdown',   // User menu dropdown
  profileLinkSelector: '.profile-link'  // Profile link
}
```

## URL Patterns with Authentication

### API Key Authentication
```typescript
searchUrlPattern: 'https://api.example.com/v1/search?q={keywords}&location={location}&api_key={api_key}'
```

### Session-based Authentication
```typescript
searchUrlPattern: 'https://example.com/search?q={keywords}&location={location}'
// Session cookies are automatically included
```

## Examples

### Complete No-Auth Platform
```typescript
export const Platform_no_auth: PlatformConfig = {
  // ... other fields
  settings: {
    requiresAuthentication: false,
    authentication: {
      type: 'none',
      requiresLogin: false,
      requiresApiKey: false,
      requiresOAuth: false,
      requiresSession: false,
      requiresCookies: false,
      persistentAuth: false
    },
    // ... other settings
  }
};
```

### Complete Login Platform
```typescript
export const Platform_login_required: PlatformConfig = {
  // ... other fields
  settings: {
    requiresAuthentication: true,
    authentication: {
      type: 'login',
      requiresLogin: true,
      requiresApiKey: false,
      requiresOAuth: false,
      requiresSession: true,
      requiresCookies: true,
      loginUrl: 'https://example.com/login',
      logoutUrl: 'https://example.com/logout',
      loginForm: {
        usernameInput: '#username',
        passwordInput: '#password',
        loginButton: '.login-button',
        formContainer: '.login-form'
      },
      authStatus: {
        loggedInIndicator: '.user-menu',
        loggedOutIndicator: '.login-link'
      },
      requiredCredentials: ['username', 'password'],
      persistentAuth: true,
      authTimeout: 3600000,
      requiresReauth: false,
      authRateLimit: 5
    },
    // ... other settings
  }
};
```

## Best Practices

1. **Always set `requiresAuthentication`** to match your authentication configuration
2. **Use specific authentication types** rather than generic settings
3. **Provide all required selectors** for login forms and status checks
4. **Set appropriate timeouts** based on platform behavior
5. **Configure rate limits** to avoid being blocked
6. **Document credential requirements** clearly in `requiredCredentials`
7. **Test authentication flows** before deploying

## Migration Guide

To update existing platform configurations:

1. Add the `authentication` object to `settings`
2. Set appropriate values based on platform requirements
3. Update `requiresAuthentication` if needed
4. Add `PlatformFeature.AUTHENTICATION` to `supportedFeatures` if authentication is required
5. Test the configuration

## Troubleshooting

### Common Issues

- **Authentication not working**: Check all required selectors are correct
- **Session persistence issues**: Verify `persistentAuth` and `requiresCookies` settings
- **Rate limiting**: Adjust `authRateLimit` based on platform restrictions
- **Timeout issues**: Set appropriate `authTimeout` values

### Debugging Tips

1. Check browser developer tools for authentication flows
2. Verify all CSS selectors are valid
3. Test authentication manually before automation
4. Monitor authentication success/failure rates
5. Check platform documentation for authentication requirements

