# MCP and Skill OAuth Integration Guidance

Status: design guidance only. This document does not describe an implemented
feature.

## Purpose

Some remote Model Context Protocol (MCP) servers and skill dependencies require
the user to sign in and grant access before they can be used. AiFetchly should
support the familiar desktop flow:

1. The user selects **Connect account**.
2. AiFetchly opens the provider's authorization page in the system browser.
3. The user signs in and approves the requested permissions.
4. The browser returns a one-time authorization code to AiFetchly.
5. AiFetchly exchanges the code for tokens and marks the connection as ready.

OAuth orchestration and credential storage should live in the Electron main
process. Skills, MCP child processes, and the renderer should not receive raw
tokens unless a narrowly scoped execution path requires one.

## Recommended Architecture

Use an OAuth broker in the Electron main process:

```text
Renderer                     Electron main process                  OAuth/MCP server
   |                                  |                                   |
   | Click "Connect"                  |                                   |
   |--------------------------------->| Discover OAuth metadata            |
   |                                  |---------------------------------->|
   |                                  | Generate PKCE + state              |
   |                                  | Open system browser                |
   |                                  |---------------------------------->|
   |                                  |            Login and consent       |
   |                                  |<--------- callback with code ------|
   |                                  | Exchange code for tokens           |
   |                                  |---------------------------------->|
   |                                  | Store tokens securely              |
   |<----------- "Connected" --------|                                   |
```

AiFetchly already contains most of the desktop OAuth building blocks:

- `src/modules/pkce.ts` generates PKCE verifiers, challenges, and OAuth state.
- `src/controller/UserController.ts` starts a loopback callback and opens the
  system browser.
- `src/modules/pendingDesktopAuth.ts` validates and expires pending login state.
- `src/modules/desktopAuthExchange.ts` consumes one-time authorization codes.
- `src/background.ts` handles custom protocol callbacks and second-instance
  activation.
- `src/modules/SecureStore.ts` wraps secrets using Electron `safeStorage`.

The MCP implementation should reuse these patterns without coupling MCP
connections to AiFetchly account login.

### Suggested responsibilities

#### `MCPAuthService`

- Discover the protected resource and authorization server metadata.
- Choose a supported client registration mechanism.
- Generate the PKCE verifier, S256 challenge, and `state`.
- Open the authorization page in the system browser.
- Validate the callback and exchange the authorization code.
- Refresh and revoke tokens.
- Handle requests for additional scopes.

#### `MCPAuthSessionStore`

- Keep pending flows in main-process memory only.
- Key each flow by a random flow identifier or MCP server identifier.
- Store the verifier, state, redirect URI, resource URI, requested scopes, and
  expiration time.
- Support concurrent logins to different MCP servers.
- Remove state after success, failure, cancellation, timeout, or application
  shutdown.

The existing desktop-login pending store has one global slot. The MCP version
should use a map because users may connect more than one provider at a time.

#### `MCPCredentialStore`

- Store access and refresh tokens through `SecureStore` or the operating-system
  credential store.
- Store only non-secret connection metadata in SQLite, such as account display
  name, scopes, expiry, and connection status.
- Store a credential reference in the MCP entity instead of storing the token in
  `MCPToolEntity.authConfig`.
- Rotate a refresh token atomically so a crash cannot restore an already-used
  token.

#### `MCPAuthProvider`

Expose a common interface for provider-specific authentication methods:

- OAuth authorization code with PKCE
- Static bearer token
- API key
- OAuth device authorization, when supported
- Credentials managed by a local stdio MCP server

Not every provider supports fully dynamic OAuth. The abstraction should allow a
provider to require a pre-registered client ID or manual configuration.

#### Renderer UI

The renderer should display status and send commands through IPC:

- Connect account
- Waiting for browser
- Connected as `<account>`
- Additional permission required
- Reconnect required
- Disconnect

The renderer should receive account metadata and connection status, never access
or refresh tokens.

## HTTP MCP Authorization Flow

For an HTTP-based MCP server, use the following flow:

1. Attempt the MCP connection without a token.
2. On `401 Unauthorized`, parse the `WWW-Authenticate` header.
3. Read the OAuth protected-resource metadata URL from the challenge. If it is
   absent, try the standard well-known protected-resource metadata locations.
4. Fetch the protected-resource metadata and identify its authorization server.
5. Fetch OAuth authorization-server metadata or OpenID Connect discovery
   metadata.
6. Confirm that the server advertises PKCE support with the S256 method.
7. Select a client registration method:
   1. Use a pre-registered AiFetchly client when available.
   2. Use an OAuth Client ID Metadata Document when supported.
   3. Use Dynamic Client Registration as a compatibility fallback.
   4. Ask the user for registered client information if no automatic mechanism
      is available.
8. Generate a PKCE verifier, its S256 challenge, and a random OAuth `state`.
9. Start an HTTP callback listener bound only to `127.0.0.1` on an operating
   system-assigned random port.
10. Open the authorization URL with Electron `shell.openExternal`.
11. Receive `code` and `state` at the loopback callback.
12. Compare `state` with the pending flow and consume the flow only once.
13. Exchange the code at the token endpoint. Include:
    - `client_id`
    - `code`
    - `code_verifier`
    - the exact `redirect_uri`
    - the canonical MCP server URI in the OAuth `resource` parameter
14. Store tokens through the secure credential store.
15. Retry MCP initialization and add the bearer token to every HTTP MCP request:

    ```http
    Authorization: Bearer <access-token>
    ```

16. Refresh the token shortly before expiry. If refresh returns
    `invalid_grant`, clear the credential and mark the server as requiring login.

Use the system browser instead of an embedded Electron `BrowserWindow`. Identity
providers commonly reject embedded authentication, and the system browser gives
users a recognizable login and consent context.

## Scope Escalation

An initially issued token may be valid but lack permission for a later tool
call. When the MCP server responds with `403 Forbidden` and
`error="insufficient_scope"`:

1. Parse the required scopes from `WWW-Authenticate`.
2. Combine the existing relevant scopes with the newly required scopes.
3. Tell the user why the additional permission is needed.
4. Start a new authorization flow.
5. Retry the original tool call at most once or twice.

Track authorization attempts by resource and operation to prevent repeated
browser prompts when a provider continues denying the same scope.

## Stdio MCP Servers and Skills

The MCP OAuth protocol applies to HTTP transports. A local stdio MCP server
normally retrieves credentials from its own configuration or environment.

AiFetchly can support either of these models:

1. The stdio MCP server owns its OAuth flow and credential storage.
2. AiFetchly performs provider OAuth and supplies a credential only to that
   specific child process.

Do not add provider tokens to the global process environment. Preserve the
existing MCP environment allowlist and inject only the credential that the
specific trusted process requires.

A skill should declare its authentication requirement rather than implementing
browser and token-storage logic itself. The skill executor can ask the main
process credential broker for a scoped credential handle. This keeps consent,
revocation, encryption, and auditing consistent across skills and MCP servers.

## Current AiFetchly Gaps

The existing MCP implementation needs transport and authorization work before
this flow can operate:

- `MCPClient.connectSSE()` currently throws an unimplemented error.
- There is no Streamable HTTP MCP transport.
- `authType` and `authConfig` are persisted, but `MCPClient` does not perform
  OAuth discovery or attach bearer authorization to network calls.
- `authConfig` is serialized into SQLite and therefore should not hold OAuth
  access tokens, refresh tokens, or confidential client secrets.
- WebSocket URLs are currently constructed with `ws://`; authenticated remote
  connections normally require secure transport and server-provided URLs.
- The client currently advertises an older MCP protocol version.

Prefer the official MCP TypeScript SDK's supported HTTP transports and
authorization-provider interfaces if they fit AiFetchly's compatibility needs.
This reduces custom protocol code for discovery, challenge parsing, reconnection,
and version negotiation.

## Data and Process Boundaries

Follow the existing three-layer architecture:

- IPC handlers validate requests and return sanitized status objects.
- A module or service owns authorization business logic.
- A model stores non-secret MCP connection metadata.
- `SecureStore` or an operating-system credential service stores secrets.
- Workers and child processes never access SQLite or Electron `safeStorage`
  directly.

The main process should retrieve the credential immediately before creating an
authenticated transport or invoking an approved child process. It should not
send the credential through renderer IPC.

## Security Requirements

- Treat Electron as a public OAuth client. Never ship a client secret inside the
  application bundle.
- If a provider requires a confidential client secret, perform the confidential
  exchange through an AiFetchly backend.
- Require HTTPS for authorization, metadata, token, revocation, and remote MCP
  endpoints. The loopback callback is the only HTTP exception.
- Prefer `127.0.0.1` over `localhost` and bind only to the loopback interface.
- Use a random callback port and a short callback timeout.
- Require PKCE with S256.
- Validate the exact state, redirect URI, authorization issuer, MCP resource,
  and token audience.
- Never log authorization codes, callback URLs, access tokens, refresh tokens,
  cookies, or authorization headers.
- Never put access tokens in URLs or query strings.
- Never send a token issued for one MCP server to another server.
- Clear local credentials on disconnect and call the provider's revocation
  endpoint when available.
- Show the MCP server hostname and requested scopes before opening the browser.
- Limit automatic authorization and scope-upgrade retries.
- Record security-safe audit events such as connected, refreshed, revoked,
  expired, and denied without recording credentials.

Custom protocol callbacks may remain as a fallback, but loopback callbacks are
preferred. If a custom protocol is used, it must carry only a one-time code and
state, never bearer tokens.

## Recommended Delivery Order

1. Add standards-compliant Streamable HTTP transport.
2. Support one pre-registered OAuth MCP server with PKCE and a loopback callback.
3. Add secure per-server credential storage and refresh-token rotation.
4. Add protected-resource and authorization-server discovery.
5. Add Client ID Metadata Document and Dynamic Client Registration support.
6. Add scope escalation, revocation, and reconnect states.
7. Expose the same credential-broker interface to skills and trusted stdio MCP
   servers.

The first milestone should prove one complete remote MCP connection from
**Connect account** through an authenticated tool call. Generalize provider
registration and scope behavior after that path is secure and testable.

## References

- [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [OAuth 2.0 for Native Apps (RFC 8252)](https://www.rfc-editor.org/rfc/rfc8252)
- [OAuth 2.0 Authorization Server Metadata (RFC 8414)](https://www.rfc-editor.org/rfc/rfc8414)
- [OAuth 2.0 Resource Indicators (RFC 8707)](https://www.rfc-editor.org/rfc/rfc8707)
- [OAuth 2.0 Protected Resource Metadata (RFC 9728)](https://www.rfc-editor.org/rfc/rfc9728)
- [Electron `shell.openExternal`](https://www.electronjs.org/docs/latest/api/shell#shellopenexternalurl-options)
- [Secure desktop auth handoff design](./custom-protocol-auth-handoff-security-fix.md)
