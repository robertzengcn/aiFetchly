# Yellow Pages Process PID Management

This document explains how to use the new PID (Process ID) management features in the Yellow Pages Process Manager.

## Overview

The Yellow Pages Process Manager now automatically saves the child process PID to the database when a task starts. This allows you to:

- Track which processes are running for which tasks
- Kill processes by PID when needed
- Check process status by PID
- Manage processes externally (e.g., from system monitoring tools)

## Database Changes

A new `pid` field has been added to the `yellow_pages_task` table:

```sql
ALTER TABLE yellow_pages_task ADD COLUMN pid INTEGER;
```

## New Methods

### 1. Finding Tasks by PID

```typescript
// Find a task by its process ID
const task = await processManager.getTaskByPID(12345);
if (task) {
    console.log(`Found task: ${task.name} (ID: ${task.id})`);
}
```

### 2. Terminating Processes by PID

```typescript
// Terminate a process by PID
const success = await processManager.terminateProcessByPID(12345);
if (success) {
    console.log('Process terminated successfully');
}
```

### 3. Checking Process Status by PID

```typescript
// Check if a process is still running
const status = await processManager.checkProcessStatusByPID(12345);
if (status.isRunning) {
    console.log(`Process ${status.taskId} is still running`);
} else {
    console.log(`Process status: ${status.status || status.error}`);
}
```

## Automatic PID Management

The system automatically:

1. **Saves PID** when a child process starts
2. **Clears PID** when a task completes, fails, or is terminated
3. **Updates PID** if a new process is spawned for the same task

## Use Cases

### External Process Monitoring

You can now monitor processes from external tools:

```bash
# Find a process by PID
ps aux | grep 12345

# Check if the process is still in our database
# (Use the checkProcessStatusByPID method)
```

### System Integration

Integrate with system monitoring tools:

```typescript
// Check all running processes
const activeProcesses = processManager.getActiveProcesses();
for (const [taskId, processInfo] of activeProcesses) {
    const pid = processInfo.process.pid;
    const status = await processManager.checkProcessStatusByPID(pid);
    console.log(`Task ${taskId}: PID ${pid}, Status: ${status.isRunning}`);
}
```

### Emergency Process Termination

Kill processes when needed:

```typescript
// Emergency termination by PID
const pid = 12345;
const success = await processManager.terminateProcessByPID(pid);
if (success) {
    console.log(`Emergency terminated process ${pid}`);
} else {
    console.log(`Failed to terminate process ${pid}`);
}
```

## Error Handling

All PID management methods include proper error handling:

- Returns `null` or `false` on failure
- Logs errors to console and log files
- Provides detailed error messages in return objects

## Best Practices

1. **Always check return values** from PID management methods
2. **Use the provided methods** instead of direct system calls
3. **Monitor PID changes** in your application logs
4. **Handle PID clearing** gracefully in your UI
5. **Use PID for debugging** when processes behave unexpectedly

## Migration Notes

- Existing tasks will have `pid` set to `null`
- New tasks will automatically get PIDs assigned
- No manual migration required
- The system is backward compatible

## Troubleshooting

### PID Not Found
- Check if the process is still running
- Verify the task exists in the database
- Check if the PID was cleared after completion

### Process Status Mismatch
- The PID might be stale (process died but PID wasn't cleared)
- Use `checkProcessStatusByPID` to get accurate status
- Consider restarting the process manager if issues persist

### Database Errors
- Ensure the `pid` column exists in the database
- Check database permissions
- Verify TypeORM configuration
