# Email Extraction Edit Functionality - Troubleshooting Guide

## Quick Diagnosis

### Common Issues and Solutions

| Issue | Likely Cause | Quick Fix |
|-------|-------------|-----------|
| Edit button not visible | Task is running/completed | Wait for task to finish |
| Can't save changes | Form validation errors | Fix highlighted errors |
| "Task not found" error | Task was deleted | Refresh page |
| Network errors | Connection issues | Check internet |
| Permission denied | No access rights | Contact admin |

## Detailed Troubleshooting

### 1. Edit Button Not Available

**Symptoms:**
- Edit button (✏️) is missing from the Actions column
- Edit button is grayed out or disabled

**Possible Causes:**
- Task is currently running
- Task has completed successfully
- Task is in an error state but not editable
- You don't have permission to edit this task

**Solutions:**
1. **Check task status** - Only pending (0) and error (2) tasks can be edited
2. **Wait for completion** - If task is running, wait for it to finish
3. **Check permissions** - Ensure you own the task or have edit rights
4. **Refresh page** - Sometimes the UI needs to be refreshed

**Prevention:**
- Monitor task status regularly
- Don't try to edit tasks while they're running
- Ensure proper permissions are set up

### 2. Form Won't Load

**Symptoms:**
- Edit form shows loading spinner indefinitely
- Form fields are empty or show error messages
- Page appears to be stuck

**Possible Causes:**
- Network connectivity issues
- Backend service unavailable
- Invalid task ID
- Database connection problems

**Solutions:**
1. **Check internet connection** - Ensure stable connectivity
2. **Refresh the page** - Try reloading the page
3. **Check task ID** - Verify the task exists in the list
4. **Clear browser cache** - Clear cookies and cache
5. **Try different browser** - Test in incognito/private mode

**Debug Steps:**
```javascript
// Check browser console for errors
// Look for network request failures
// Verify task ID in URL
```

### 3. Can't Save Changes

**Symptoms:**
- Save button is disabled
- Form shows validation errors
- Save operation fails with error message

**Possible Causes:**
- Form validation errors
- Network connectivity issues
- Task status changed during editing
- Server-side validation failed

**Solutions:**
1. **Fix validation errors** - Address all red error messages
2. **Check field values** - Ensure all required fields are filled
3. **Refresh and retry** - Reload page and try again
4. **Check task status** - Verify task is still editable

**Common Validation Errors:**
- Empty URL list
- Invalid URL format
- Page length out of range (1-1000)
- Concurrency out of range (1-10)
- Timeout out of range (1-20 minutes)

### 4. "Task Not Found" Error

**Symptoms:**
- Error message: "Task not found"
- 404 error when accessing edit page
- Task missing from list

**Possible Causes:**
- Task was deleted by another user
- Task ID is invalid or corrupted
- Database synchronization issues
- Network request failed

**Solutions:**
1. **Refresh task list** - Check if task still exists
2. **Navigate from list** - Use the edit button from task list
3. **Check URL** - Verify task ID in browser address bar
4. **Contact support** - If task should exist but doesn't

**Prevention:**
- Don't bookmark edit URLs directly
- Always navigate from task list
- Check task existence before editing

### 5. Network Connection Errors

**Symptoms:**
- "Network connection failed" error
- Request timeout messages
- Spinning loading indicators

**Possible Causes:**
- Internet connectivity issues
- Firewall blocking requests
- Server overload
- DNS resolution problems

**Solutions:**
1. **Check internet connection** - Test other websites
2. **Disable VPN/proxy** - If using one
3. **Try different network** - Switch to mobile hotspot
4. **Wait and retry** - Server might be temporarily overloaded
5. **Check firewall settings** - Ensure application is allowed

**Recovery Options:**
- Retry with exponential backoff
- Queue operation for when online
- Manual retry after connection restored

### 6. Permission Denied Errors

**Symptoms:**
- "Permission denied" error messages
- Edit/delete buttons not visible
- Access restricted messages

**Possible Causes:**
- Insufficient user permissions
- Task ownership issues
- Role-based access restrictions
- Session expired

**Solutions:**
1. **Check user role** - Verify you have edit permissions
2. **Log out and back in** - Refresh session
3. **Contact administrator** - Request proper permissions
4. **Check task ownership** - Ensure you own the task

**Prevention:**
- Regular permission audits
- Clear role definitions
- Proper user onboarding

### 7. Form Data Not Loading

**Symptoms:**
- Form fields are empty
- Default values not populated
- "Loading data" message persists

**Possible Causes:**
- API request failed
- Data format issues
- Missing task data
- Cache problems

**Solutions:**
1. **Refresh page** - Force reload of data
2. **Clear browser cache** - Remove cached data
3. **Check network tab** - Verify API calls succeed
4. **Try different browser** - Test in incognito mode

**Debug Information:**
```javascript
// Check browser console for API errors
// Verify network requests in DevTools
// Check response data format
```

### 8. Delete Operation Fails

**Symptoms:**
- Delete button not available
- Delete confirmation fails
- "Cannot delete task" error

**Possible Causes:**
- Task is currently running
- Task has dependencies
- Insufficient permissions
- Database constraints

**Solutions:**
1. **Wait for completion** - Let running task finish
2. **Check dependencies** - Remove related data first
3. **Verify permissions** - Ensure delete rights
4. **Contact support** - For complex deletion issues

### 9. Validation Errors

**Symptoms:**
- Red error messages on form
- Save button disabled
- Field highlighting in red

**Common Validation Issues:**

#### URL Validation
- **Error**: "Invalid URL format"
- **Solution**: Ensure URLs start with `http://` or `https://`
- **Example**: `https://example.com` ✅, `example.com` ❌

#### Numeric Field Validation
- **Error**: "Value out of range"
- **Solution**: Check field limits:
  - Page Length: 1-1000
  - Concurrency: 1-10
  - Process Timeout: 1-20 minutes
  - Max Page Number: 0-1000

#### Required Field Validation
- **Error**: "Field is required"
- **Solution**: Fill in all required fields
- **Required fields**: URLs, Page Length, Concurrency

### 10. Performance Issues

**Symptoms:**
- Slow form loading
- Laggy user interface
- Timeout errors

**Possible Causes:**
- Large task data
- Network latency
- Browser performance issues
- Server overload

**Solutions:**
1. **Close other tabs** - Free up browser resources
2. **Restart browser** - Clear memory and cache
3. **Check network speed** - Use faster connection
4. **Contact support** - Report performance issues

## Advanced Troubleshooting

### Browser Console Debugging

1. **Open Developer Tools**
   - Press F12 or right-click → Inspect
   - Go to Console tab

2. **Look for Errors**
   ```javascript
   // Common error patterns
   TypeError: Cannot read property 'x' of undefined
   NetworkError: Failed to fetch
   ValidationError: Invalid input
   ```

3. **Check Network Requests**
   - Go to Network tab
   - Look for failed API calls
   - Check response status codes

### Database Issues

**Symptoms:**
- Data not saving
- Inconsistent task states
- Missing task data

**Solutions:**
1. **Check database connection**
2. **Verify data integrity**
3. **Contact database administrator**

### Server-Side Issues

**Symptoms:**
- 500 Internal Server Error
- Service unavailable messages
- Timeout errors

**Solutions:**
1. **Check server status**
2. **Wait for maintenance to complete**
3. **Contact system administrator**

## Prevention Strategies

### Best Practices

1. **Regular Monitoring**
   - Check task status frequently
   - Monitor for error messages
   - Verify data consistency

2. **Proper Workflow**
   - Always navigate from task list
   - Don't bookmark edit URLs directly
   - Save changes frequently

3. **Data Validation**
   - Double-check form data before saving
   - Test URLs before adding them
   - Verify numeric field values

4. **Network Management**
   - Use stable internet connection
   - Avoid editing during network issues
   - Have backup connection ready

### Maintenance

1. **Regular Updates**
   - Keep browser updated
   - Clear cache periodically
   - Update application when available

2. **Backup Procedures**
   - Export important task data
   - Document task configurations
   - Keep screenshots of critical settings

## Getting Help

### When to Contact Support

Contact technical support when:
- Issues persist after trying all solutions
- Error messages are unclear or unhelpful
- Data loss has occurred
- Security concerns arise

### Information to Provide

When contacting support, include:
1. **Error messages** - Exact text and context
2. **Steps to reproduce** - Detailed step-by-step process
3. **Task ID** - The specific task causing issues
4. **Browser information** - Version and type
5. **Screenshots** - Visual evidence of the problem
6. **Console logs** - Any error messages from browser console

### Support Channels

- **Email**: support@aifetchly.com
- **Phone**: +1-555-123-4567
- **Chat**: Available during business hours
- **Documentation**: Check this guide and user manual first

## Emergency Procedures

### Data Recovery

If task data is lost:
1. **Check task list** - Task might still exist
2. **Look for backups** - Check if data was exported
3. **Contact support** - For data recovery assistance

### System Outages

During system maintenance:
1. **Wait for completion** - Don't attempt edits
2. **Check status page** - For maintenance updates
3. **Plan ahead** - Schedule edits for after maintenance

### Security Incidents

If security issues are suspected:
1. **Stop all operations** - Don't make changes
2. **Contact security team** - Immediately
3. **Document everything** - For investigation
4. **Change passwords** - If credentials compromised 