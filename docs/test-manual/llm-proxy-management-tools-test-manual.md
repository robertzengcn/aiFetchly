# LLM Proxy Management Tools - Manual Test Cases

**Related PRD**: `docs/prd/llm-proxy-management-tools-prd.md`
**Related design**: `docs/prd/llm-proxy-management-tools-technical-design.md`
**Date**: 2026-07-26
**Total**: 52 test cases

These cases manually verify AI Chat proxy management tools: credential redaction, CRUD operations, permission prompts, proxy validation, batch checking, and safety boundaries.

---

## 0. Test Setup

### Required environment

- App dependencies installed with `yarn`
- App database initialized if needed with `yarn init`
- AI Chat is enabled in settings (`USER_AI_ENABLED = "true"`)
- Use AI Chat V2 / OpenAI-compatible chat path
- Terminal logs are visible from the `yarn dev` process
- Proxy page accessible at `http://localhost:5173` for verification

### Recommended test data

Prepare at least one of these before testing:

- At least 3 proxy records in the database (mix of protocols: http, socks5)
- At least one proxy with credentials (username + password)
- At least one proxy with Google pass status
- A list of proxies for import testing

### Useful launch commands

```bash
yarn dev
```

---

## 1. Credential Redaction Tests

### TC-1: proxy_list does not expose passwords

1. Start the app with `yarn dev`.
2. Open AI Chat.
3. Send:

```text
List my proxies.
```

4. **Verify**: The response shows proxy summaries.
5. **Verify**: No `pass` or `password` field appears in the response.
6. **Verify**: Proxies with passwords show `hasPassword: true` or similar indicator.
7. **Verify in logs**: No raw password values are logged in tool output.

### TC-2: proxy_get does not expose credentials

1. Open AI Chat.
2. Send:

```text
Get details for proxy #1.
```

3. **Verify**: The response shows one proxy summary.
4. **Verify**: No `pass` or `password` field appears.
5. **Verify**: `hasPassword` indicates whether credentials exist.

### TC-3: proxy_create does not echo password in response

1. Open AI Chat.
2. Send:

```text
Add proxy http://test-cred.example.com:8080 with username testuser and password testpass123.
```

3. **Verify**: A permission prompt appears.
4. Approve the permission.
5. **Verify**: The response confirms creation with proxy ID.
6. **Verify**: No `pass` or `password` value appears in the response.
7. **Verify**: The proxy appears on the Proxy page.
8. Clean up: Delete the test proxy.

### TC-4: proxy_update does not expose old password

1. Ensure a proxy with credentials exists.
2. Open AI Chat.
3. Send:

```text
Update proxy #<id> to port 9999.
```

4. **Verify**: Permission prompt appears.
5. Approve.
6. **Verify**: Response shows before/after summary without password values.
7. Clean up: Restore original port or delete.

---

## 2. Read-Only Tool Tests

### TC-5: proxy_list returns paginated results

1. Ensure at least 5 proxies exist.
2. Open AI Chat.
3. Send:

```text
Show me my first 3 proxies.
```

4. **Verify**: The response shows up to 3 proxies.
5. **Verify**: Total count is displayed.
6. **Verify**: Page and size information is included.

### TC-6: proxy_list filters by status

1. Ensure proxies with different statuses exist (pass, failure, unknown).
2. Open AI Chat.
3. Send:

```text
Show me proxies that failed validation.
```

4. **Verify**: Only failed proxies are returned.
5. **Verify**: No proxies with "pass" status appear.

### TC-7: proxy_list filters by protocol

1. Open AI Chat.
2. Send:

```text
Show me only SOCKS5 proxies.
```

3. **Verify**: Only SOCKS5 proxies are returned.
4. **Verify**: Protocol information is displayed.

### TC-8: proxy_get returns exact proxy by ID

1. Note a valid proxy ID (e.g., #1).
2. Open AI Chat.
3. Send:

```text
Get proxy #1.
```

4. **Verify**: The response shows exactly one proxy.
5. **Verify**: The proxy ID matches the requested ID.

### TC-9: proxy_get handles non-existent ID

1. Open AI Chat.
2. Send:

```text
Get proxy #99999.
```

3. **Verify**: The response indicates proxy not found.
4. **Verify**: Error code is `PROXY_NOT_FOUND`.

---

## 3. Create Proxy Tests

### TC-10: proxy_create adds a new proxy

1. Open AI Chat.
2. Send:

```text
Add proxy http://192.168.1.100:3128 with username admin and password secret123.
```

3. **Verify**: Permission prompt appears with proxy details.
4. Approve the permission.
5. **Verify**: Response confirms creation with new proxy ID.
6. **Verify**: Proxy appears on the Proxy page with correct host, port, protocol.
7. Clean up: Delete the test proxy.

### TC-11: proxy_create normalizes port to string

1. Open AI Chat.
2. Send:

```text
Add proxy http://192.168.1.101:8888.
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Proxy is created successfully.
6. **Verify on Proxy page**: Port is displayed as "8888" (string format).
7. Clean up: Delete the test proxy.

### TC-12: proxy_create normalizes protocol to lowercase

1. Open AI Chat.
2. Send:

```text
Add proxy HTTPS://secure-proxy.example.com:443.
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Proxy is created with protocol "https" (lowercase).
6. Clean up: Delete the test proxy.

### TC-13: proxy_create rejects invalid protocol

1. Open AI Chat.
2. Send:

```text
Add proxy ftp://invalid-proxy.example.com:21.
```

3. **Verify**: The response indicates invalid protocol.
4. **Verify**: Error code is `INVALID_INPUT`.

### TC-14: proxy_create rejects invalid port

1. Open AI Chat.
2. Send:

```text
Add proxy http://test.example.com:99999.
```

3. **Verify**: The response indicates invalid port.
4. **Verify**: Error code is `INVALID_INPUT`.

### TC-15: proxy_create rejects empty host

1. Open AI Chat.
2. Send:

```text
Add proxy http://:8080.
```

3. **Verify**: The response indicates invalid host.
4. **Verify**: Error code is `INVALID_INPUT`.

### TC-16: proxy_create rejects duplicate proxy

1. Ensure a proxy at `192.168.1.100:3128` exists.
2. Open AI Chat.
3. Send:

```text
Add proxy http://192.168.1.100:3128.
```

4. **Verify**: The response indicates duplicate proxy.
5. **Verify**: Error code is `DUPLICATE_PROXY`.

---

## 4. Update Proxy Tests

### TC-17: proxy_update changes port

1. Note a valid proxy ID and its current port.
2. Open AI Chat.
3. Send:

```text
Change proxy #<id> to port 8081.
```

4. **Verify**: Permission prompt appears.
5. Approve.
6. **Verify**: Response shows updated proxy with new port.
7. **Verify on Proxy page**: Port is updated.
8. Clean up: Restore original port.

### TC-18: proxy_update changes host

1. Open AI Chat.
2. Send:

```text
Update proxy #<id> host to new-host.example.com.
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Host is updated.
6. Clean up: Restore original host.

### TC-19: proxy_update clears credentials with null

1. Open AI Chat.
2. Send:

```text
Update proxy #<id> to remove username and password.
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Credentials are cleared.
6. **Verify on Proxy page**: Username and password fields are empty.

### TC-20: proxy_update rejects expected_host mismatch

1. Note proxy #<id> has host "original-host.example.com".
2. Open AI Chat.
3. Send:

```text
Update proxy #<id> to port 9090, but only if the host is wrong-host.example.com.
```

4. **Verify**: The response indicates expected host mismatch.
5. **Verify**: Error code is `EXPECTED_PROXY_MISMATCH`.
6. **Verify**: No update occurs.

### TC-21: proxy_update rejects expected_port mismatch

1. Note proxy #<id> has port "8080".
2. Open AI Chat.
3. Send:

```text
Update proxy #<id> to port 9090, but only if current port is 7777.
```

4. **Verify**: The response indicates expected port mismatch.
5. **Verify**: Error code is `EXPECTED_PROXY_MISMATCH`.
6. **Verify**: No update occurs.

### TC-22: proxy_update rejects empty update fields

1. Open AI Chat.
2. Send:

```text
Update proxy #<id> with no changes.
```

3. **Verify**: The response indicates no update fields provided.
4. **Verify**: Error code is `INVALID_INPUT`.

---

## 5. Delete Proxy Tests

### TC-23: proxy_delete removes a proxy

1. Create a test proxy first.
2. Note its ID.
3. Open AI Chat.
4. Send:

```text
Delete proxy #<id>.
```

5. **Verify**: Permission prompt appears.
6. Approve.
7. **Verify**: Response confirms deletion.
8. **Verify on Proxy page**: Proxy is removed from the list.

### TC-24: proxy_delete with expected_host confirmation

1. Create a test proxy with host "confirm-host.example.com".
2. Note its ID.
3. Open AI Chat.
4. Send:

```text
Delete proxy #<id> if the host is confirm-host.example.com.
```

5. **Verify**: Permission prompt appears.
6. Approve.
7. **Verify**: Proxy is deleted (host matches).

### TC-25: proxy_delete rejects expected_host mismatch

1. Create a test proxy with host "real-host.example.com".
2. Note its ID.
3. Open AI Chat.
4. Send:

```text
Delete proxy #<id> if the host is wrong-host.example.com.
```

5. **Verify**: The response indicates expected host mismatch.
6. **Verify**: Error code is `EXPECTED_PROXY_MISMATCH`.
7. **Verify**: Proxy is not deleted.
8. Clean up: Delete the test proxy manually.

### TC-26: proxy_delete rejects non-existent ID

1. Open AI Chat.
2. Send:

```text
Delete proxy #99999.
```

3. **Verify**: The response indicates proxy not found.
4. **Verify**: Error code is `PROXY_NOT_FOUND`.

---

## 6. Import Proxy Tests

### TC-27: proxy_import adds multiple proxies

1. Open AI Chat.
2. Send:

```text
Import these proxies:
http://10.0.0.1:8080
http://10.0.0.2:8080
socks5://10.0.0.3:1080
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Response shows imported count (3).
6. **Verify on Proxy page**: All 3 proxies appear in the list.
7. Clean up: Delete the test proxies.

### TC-28: proxy_import skips duplicates by default

1. Ensure proxy `10.0.0.1:8080` already exists.
2. Open AI Chat.
3. Send:

```text
Import these proxies:
http://10.0.0.1:8080
http://10.0.0.5:8080
```

4. **Verify**: Permission prompt appears.
5. Approve.
6. **Verify**: Response shows imported count (1) and skipped count (1).
7. Clean up: Delete the new test proxy.

### TC-29: proxy_import rejects on duplicate with fail policy

1. Ensure proxy `10.0.0.1:8080` already exists.
2. Open AI Chat.
3. Send:

```text
Import these proxies and fail if any duplicate exists:
http://10.0.0.1:8080
http://10.0.0.6:8080
```

4. **Verify**: The response indicates import failed due to duplicate.
5. **Verify**: No new proxies are created.

### TC-30: proxy_import reports invalid rows

1. Open AI Chat.
2. Send:

```text
Import these proxies:
http://10.0.0.7:8080
invalid-proxy-format
http://10.0.0.8:99999
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Response shows imported count for valid rows.
6. **Verify**: Response indicates invalid rows with details.
7. Clean up: Delete the valid test proxies.

### TC-31: proxy_import handles max batch size

1. Open AI Chat.
2. Send a request to import more than 500 proxies (if feasible to generate).
3. **Verify**: The response indicates batch size limit exceeded.
4. **Verify**: Error code is `INVALID_INPUT`.

---

## 7. Permission Prompt Tests

### TC-32: proxy_list does not require permission

1. Open AI Chat.
2. Send:

```text
List my proxies.
```

3. **Verify**: No permission prompt appears.
4. **Verify**: Results are returned directly.

### TC-33: proxy_get does not require permission

1. Open AI Chat.
2. Send:

```text
Get proxy #1.
```

3. **Verify**: No permission prompt appears.
4. **Verify**: Result is returned directly.

### TC-34: proxy_create requires permission

1. Open AI Chat.
2. Send:

```text
Add proxy http://perm-test.example.com:8080.
```

3. **Verify**: Permission prompt appears.
4. **Verify**: Prompt shows tool name and action details.
5. Deny the permission.
6. **Verify**: Proxy is not created.

### TC-35: proxy_update requires permission

1. Open AI Chat.
2. Send:

```text
Update proxy #1 to port 8080.
```

3. **Verify**: Permission prompt appears.
4. Deny the permission.
5. **Verify**: Proxy is not updated.

### TC-36: proxy_delete requires permission

1. Open AI Chat.
2. Send:

```text
Delete proxy #1.
```

3. **Verify**: Permission prompt appears.
4. Deny the permission.
5. **Verify**: Proxy is not deleted.

### TC-37: proxy_import requires permission

1. Open AI Chat.
2. Send:

```text
Import proxy http://perm-import.example.com:8080.
```

3. **Verify**: Permission prompt appears.
4. Deny the permission.
5. **Verify**: Proxy is not imported.

### TC-38: proxy_check requires permission

1. Open AI Chat.
2. Send:

```text
Check proxy #1.
```

3. **Verify**: Permission prompt appears.
4. Deny the permission.
5. **Verify**: Proxy check does not run.

---

## 8. Proxy Check Tests

### TC-39: proxy_check validates single proxy

1. Open AI Chat.
2. Send:

```text
Check proxy #1 with a 10 second timeout.
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Response shows check results (pass/failure).
6. **Verify**: Basic check status is updated on Proxy page.

### TC-40: proxy_check validates multiple proxies

1. Open AI Chat.
2. Send:

```text
Check proxies #1, #2, and #3.
```

2. **Verify**: Permission prompt appears.
3. Approve.
4. **Verify**: Response shows results for all 3 proxies.
5. **Verify**: Each proxy has basic check status.

### TC-41: proxy_check runs Google check mode

1. Open AI Chat.
2. Send:

```text
Check proxy #1 for Google access with a 20 second timeout.
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Response includes Google pass status.
6. **Verify on Proxy page**: Google pass status is updated.

### TC-42: proxy_check with basic-only mode

1. Open AI Chat.
2. Send:

```text
Check proxy #1 basic connectivity only.
```

3. **Verify**: Permission prompt appears.
4. Approve.
5. **Verify**: Response includes basic check status.
6. **Verify**: Google pass status is not changed.

### TC-43: proxy_check rejects calls without target

1. Open AI Chat.
2. Send:

```text
Run a proxy check.
```

3. **Verify**: The response indicates no target selector provided.
4. **Verify**: Error code is `INVALID_INPUT`.

---

## 9. Remove Failed Proxy Tests

### TC-44: proxy_remove_failed dry run lists candidates

1. Ensure some proxies have failed status.
2. Open AI Chat.
3. Send:

```text
Show me which proxies would be removed if I clean up failed ones.
```

4. **Verify**: The assistant lists failed proxy candidates.
5. **Verify**: No proxies are actually deleted.

### TC-45: proxy_remove_failed deletes failed proxies

1. Ensure some proxies have failed status.
2. Open AI Chat.
3. Send:

```text
Remove all proxies that failed the basic check.
```

4. **Verify**: Permission prompt appears.
5. Approve.
6. **Verify**: Response shows deleted count.
7. **Verify on Proxy page**: Failed proxies are removed.

---

## 10. Conversation Flow Tests

### TC-46: Multi-step proxy workflow

1. Open a fresh AI Chat conversation.
2. Send:

```text
Add proxy http://workflow-test.example.com:8080.
```

3. Approve the permission.
4. Note the returned proxy ID.
5. Send:

```text
Now check that proxy.
```

6. Approve the permission.
7. **Verify**: Check results are returned.
8. Send:

```text
Delete that proxy.
```

9. Approve the permission.
10. **Verify**: Proxy is deleted.
11. **Verify**: The conversation maintains context about which proxy is being discussed.

### TC-47: Assistant clarifies ambiguous proxy reference

1. Ensure multiple proxies exist with similar hosts.
2. Open AI Chat.
3. Send:

```text
Delete the proxy on example.com.
```

4. **Verify**: The assistant lists matching proxies and asks for clarification.
5. **Verify**: No deletion occurs until exact ID is provided.

### TC-48: Assistant lists candidates before destructive operations

1. Open AI Chat.
2. Send:

```text
Remove all failed proxies.
```

3. **Verify**: The assistant first lists the candidates.
4. **Verify**: The assistant asks for confirmation before proceeding.

---

## 11. AI Feature Gate Tests

### TC-49: Proxy tools require AI to be enabled

1. Disable AI in settings (`USER_AI_ENABLED = "false"`).
2. Open AI Chat.
3. Send:

```text
List my proxies.
```

4. **Verify**: The request is rejected or AI Chat does not respond.
5. Re-enable AI.

---

## 12. Existing UI Compatibility Tests

### TC-50: Proxy page list still works

1. Open the Proxy page.
2. **Verify**: Proxy list loads correctly.
3. **Verify**: Search and filters work.
4. **Verify**: Pagination works.

### TC-51: Proxy page manual add still works

1. Open the Proxy page.
2. Add a proxy manually through the UI.
3. **Verify**: Proxy is saved correctly.
4. **Verify**: Proxy appears in the list.
5. Clean up: Delete the test proxy.

### TC-52: Proxy page check still works

1. Open the Proxy page.
2. Select a proxy and click check.
3. **Verify**: Check runs and status updates.
4. **Verify**: Google pass status updates if applicable.

---

## Manual Test Summary Checklist

Use this checklist after running the cases above:

- [ ] `proxy_list` and `proxy_get` never expose passwords in responses.
- [ ] `proxy_create` requires permission and creates valid proxies.
- [ ] `proxy_update` requires permission and updates correctly.
- [ ] `proxy_delete` requires permission and removes proxies.
- [ ] `proxy_import` handles batches, duplicates, and invalid rows.
- [ ] `proxy_check` validates proxies and updates status.
- [ ] `proxy_remove_failed` has dry-run and delete modes.
- [ ] Permission prompts appear for all mutating operations.
- [ ] Read-only tools (`proxy_list`, `proxy_get`) do not require permission.
- [ ] Expected host/port safety checks prevent stale operations.
- [ ] Protocol and port normalization work correctly.
- [ ] Existing Proxy page UI still functions correctly.
- [ ] Multi-step workflows maintain conversation context.
- [ ] Ambiguous references are clarified before destructive actions.
- [ ] AI feature gate blocks tools when AI is disabled.
