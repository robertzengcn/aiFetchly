# Yellow Pages PID Management Usage Examples

This document provides practical examples of how to use the new PID management features in the Yellow Pages system.

## Overview

The system now provides two main PID management functions:
1. **Kill Process by PID** - Terminate a running process using its PID
2. **Get Process Status by PID** - Check the status of a process using its PID

## Frontend Usage Examples

### 1. Killing a Process by PID

```typescript
import { killProcessByPID } from '@/views/api/yellowpages';

// Example: Kill a process with PID 12345
async function handleKillProcess() {
    try {
        const result = await killProcessByPID(12345);
        
        if (result.success) {
            console.log(`Process killed successfully: ${result.message}`);
            if (result.taskId) {
                console.log(`Task ID: ${result.taskId}`);
            }
            // Update UI to reflect the process was killed
            showSuccessMessage(`Process ${12345} killed successfully`);
        } else {
            console.error(`Failed to kill process: ${result.message}`);
            showErrorMessage(`Failed to kill process: ${result.message}`);
        }
    } catch (error) {
        console.error('Error killing process:', error);
        showErrorMessage(`Error: ${error.message}`);
    }
}

// Example: Kill process from a button click
document.getElementById('killProcessBtn').addEventListener('click', () => {
    const pid = parseInt(document.getElementById('pidInput').value);
    if (pid) {
        handleKillProcess(pid);
    }
});
```

### 2. Checking Process Status by PID

```typescript
import { getProcessStatusByPID } from '@/views/api/yellowpages';

// Example: Check status of a process with PID 12345
async function checkProcessStatus(pid: number) {
    try {
        const status = await getProcessStatusByPID(pid);
        
        if (status.isRunning) {
            console.log(`Process ${pid} is running for task ${status.taskId}`);
            console.log(`Status: ${status.status}`);
            // Update UI to show process is running
            updateProcessStatusUI(pid, 'running', status.taskId);
        } else {
            console.log(`Process ${pid} is not running`);
            if (status.error) {
                console.log(`Error: ${status.error}`);
            } else if (status.status) {
                console.log(`Final status: ${status.status}`);
            }
            // Update UI to show process is not running
            updateProcessStatusUI(pid, 'stopped');
        }
    } catch (error) {
        console.error('Error checking process status:', error);
        showErrorMessage(`Error checking status: ${error.message}`);
    }
}

// Example: Check status from a button click
document.getElementById('checkStatusBtn').addEventListener('click', () => {
    const pid = parseInt(document.getElementById('pidInput').value);
    if (pid) {
        checkProcessStatus(pid);
    }
});
```

### 3. Complete Process Management Component

```typescript
import { killProcessByPID, getProcessStatusByPID } from '@/views/api/yellowpages';

class ProcessManager {
    private processList: Map<number, ProcessInfo> = new Map();

    constructor() {
        this.initializeEventListeners();
    }

    private initializeEventListeners() {
        // Kill process button
        document.getElementById('killProcessBtn')?.addEventListener('click', () => {
            const pid = this.getSelectedPID();
            if (pid) {
                this.killProcess(pid);
            }
        });

        // Check status button
        document.getElementById('checkStatusBtn')?.addEventListener('click', () => {
            const pid = this.getSelectedPID();
            if (pid) {
                this.checkProcessStatus(pid);
            }
        });

        // Refresh all processes button
        document.getElementById('refreshProcessesBtn')?.addEventListener('click', () => {
            this.refreshAllProcesses();
        });
    }

    private getSelectedPID(): number | null {
        const pidInput = document.getElementById('pidInput') as HTMLInputElement;
        const pid = parseInt(pidInput.value);
        return isNaN(pid) ? null : pid;
    }

    async killProcess(pid: number) {
        try {
            this.showLoading(`Killing process ${pid}...`);
            
            const result = await killProcessByPID(pid);
            
            if (result.success) {
                this.showSuccess(`Process ${pid} killed successfully`);
                if (result.taskId) {
                    this.showInfo(`Task ID: ${result.taskId}`);
                }
                // Remove from process list
                this.processList.delete(pid);
                this.updateProcessListUI();
            } else {
                this.showError(`Failed to kill process: ${result.message}`);
            }
        } catch (error) {
            this.showError(`Error killing process: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async checkProcessStatus(pid: number) {
        try {
            this.showLoading(`Checking status for process ${pid}...`);
            
            const status = await getProcessStatusByPID(pid);
            
            if (status.isRunning) {
                this.showSuccess(`Process ${pid} is running`);
                this.showInfo(`Task ID: ${status.taskId}, Status: ${status.status}`);
                
                // Update process list
                this.processList.set(pid, {
                    pid,
                    taskId: status.taskId,
                    status: status.status || 'running',
                    isRunning: true
                });
            } else {
                this.showWarning(`Process ${pid} is not running`);
                if (status.error) {
                    this.showError(`Error: ${status.error}`);
                } else if (status.status) {
                    this.showInfo(`Final status: ${status.status}`);
                }
                
                // Remove from process list if not running
                this.processList.delete(pid);
            }
            
            this.updateProcessListUI();
        } catch (error) {
            this.showError(`Error checking status: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async refreshAllProcesses() {
        // This would typically get all active processes from the backend
        // For now, we'll just refresh the UI
        this.updateProcessListUI();
    }

    private updateProcessListUI() {
        const processListElement = document.getElementById('processList');
        if (!processListElement) return;

        processListElement.innerHTML = '';
        
        for (const [pid, info] of this.processList) {
            const processItem = document.createElement('div');
            processItem.className = 'process-item';
            processItem.innerHTML = `
                <span class="pid">PID: ${pid}</span>
                <span class="task-id">Task: ${info.taskId || 'Unknown'}</span>
                <span class="status ${info.isRunning ? 'running' : 'stopped'}">${info.status}</span>
                <button onclick="processManager.killProcess(${pid})" class="kill-btn">Kill</button>
                <button onclick="processManager.checkProcessStatus(${pid})" class="status-btn">Check Status</button>
            `;
            processListElement.appendChild(processItem);
        }
    }

    // UI Helper Methods
    private showLoading(message: string) {
        // Implementation for showing loading state
    }

    private hideLoading() {
        // Implementation for hiding loading state
    }

    private showSuccess(message: string) {
        // Implementation for showing success message
    }

    private showError(message: string) {
        // Implementation for showing error message
    }

    private showWarning(message: string) {
        // Implementation for showing warning message
    }

    private showInfo(message: string) {
        // Implementation for showing info message
    }
}

// Initialize the process manager
const processManager = new ProcessManager();
```

### 4. HTML Template Example

```html
<div class="process-management-panel">
    <h3>Process Management</h3>
    
    <div class="input-group">
        <label for="pidInput">Process ID (PID):</label>
        <input type="number" id="pidInput" placeholder="Enter PID (e.g., 12345)" />
    </div>
    
    <div class="button-group">
        <button id="checkStatusBtn" class="btn btn-primary">Check Status</button>
        <button id="killProcessBtn" class="btn btn-danger">Kill Process</button>
        <button id="refreshProcessesBtn" class="btn btn-secondary">Refresh All</button>
    </div>
    
    <div class="process-list">
        <h4>Active Processes</h4>
        <div id="processList" class="process-list-container">
            <!-- Process items will be dynamically added here -->
        </div>
    </div>
    
    <div class="status-messages">
        <div id="loadingMessage" class="message loading" style="display: none;">
            <span class="spinner"></span>
            <span id="loadingText">Loading...</span>
        </div>
        <div id="successMessage" class="message success" style="display: none;"></div>
        <div id="errorMessage" class="message error" style="display: none;"></div>
        <div id="warningMessage" class="message warning" style="display: none;"></div>
        <div id="infoMessage" class="message info" style="display: none;"></div>
    </div>
</div>
```

### 5. CSS Styling Example

```css
.process-management-panel {
    padding: 20px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #f9f9f9;
}

.input-group {
    margin-bottom: 15px;
}

.input-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
}

.input-group input {
    width: 100%;
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
}

.button-group {
    margin-bottom: 20px;
}

.button-group button {
    margin-right: 10px;
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.btn-primary { background: #007bff; color: white; }
.btn-danger { background: #dc3545; color: white; }
.btn-secondary { background: #6c757d; color: white; }

.process-list-container {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
}

.process-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px;
    border-bottom: 1px solid #eee;
}

.process-item:last-child {
    border-bottom: none;
}

.process-item .pid {
    font-weight: bold;
    color: #007bff;
}

.process-item .task-id {
    color: #666;
}

.process-item .status {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: bold;
}

.process-item .status.running {
    background: #28a745;
    color: white;
}

.process-item .status.stopped {
    background: #dc3545;
    color: white;
}

.message {
    padding: 10px;
    margin: 10px 0;
    border-radius: 4px;
    display: none;
}

.message.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.message.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
.message.warning { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
.message.info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
.message.loading { background: #e2e3e5; color: #383d41; border: 1px solid #d6d8db; }

.spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid #f3f3f3;
    border-top: 2px solid #3498db;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 8px;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
```

## Backend Integration

The backend now provides these IPC endpoints:

- `YELLOW_PAGES_KILL_PROCESS` - Kill a process by PID
- `yellow_pages:get_process_status` - Get process status by PID

## Error Handling

All functions include comprehensive error handling:

- Network errors
- Invalid PID values
- Process not found
- Permission errors
- System errors

## Best Practices

1. **Always validate PID input** before sending to backend
2. **Show loading states** during operations
3. **Handle errors gracefully** with user-friendly messages
4. **Refresh process lists** after operations
5. **Use appropriate button states** (disabled during operations)
6. **Log operations** for debugging purposes
7. **Provide confirmation** before killing processes

## Security Considerations

- PIDs are validated on the backend
- Only processes associated with user tasks can be killed
- All operations are logged for audit purposes
- Rate limiting should be implemented for process operations
