# Email Extraction Edit Functionality - User Guide

## Introduction

The email extraction edit functionality allows you to modify existing email extraction tasks that are in a pending or error state. This guide will help you understand how to use this feature effectively.

## Getting Started

### Prerequisites
- You must have an existing email extraction task
- The task must be in "Pending" or "Error" status
- You must have permission to edit the task

### Accessing the Edit Feature

1. **Navigate to Task List**
   - Go to the Email Extraction section
   - Click on "Task List" to view all your tasks

2. **Find Your Task**
   - Look for the task you want to edit
   - Check the status column to ensure it's "Pending" or "Error"

3. **Click Edit Button**
   - Click the pencil icon (✏️) in the Actions column
   - This will open the edit form with your current task data

## Editing Your Task

### Form Overview

The edit form contains the same fields as the creation form, but they're pre-populated with your current task data:

- **Extraction Type**: Manual input URLs or Search results
- **URLs**: List of websites to extract emails from
- **Page Length**: Number of pages to extract per URL
- **Concurrency**: Number of simultaneous processes
- **Process Timeout**: Maximum time per process (minutes)
- **Max Page Number**: Maximum number of pages to process
- **Proxy Settings**: Optional proxy configuration

### Making Changes

1. **Modify Fields**
   - Click on any field to edit its value
   - Use the validation hints to ensure your input is correct

2. **Add/Remove URLs**
   - Add new URLs by typing them in the URL field
   - Remove URLs by clicking the delete button next to them
   - Each URL should start with `http://` or `https://`

3. **Adjust Settings**
   - Change page length (1-1000)
   - Modify concurrency (1-10)
   - Update timeout settings (1-20 minutes)
   - Adjust max page number (0-1000)

### Validation Rules

The form will validate your input in real-time:

- **URLs**: Must be valid web addresses
- **Page Length**: Must be between 1 and 1000
- **Concurrency**: Must be between 1 and 10
- **Process Timeout**: Must be between 1 and 20 minutes
- **Max Page Number**: Must be between 0 and 1000

### Saving Changes

1. **Review Your Changes**
   - Double-check all your modifications
   - Ensure all validation errors are resolved

2. **Click Save**
   - Click the "Save" button to apply your changes
   - The system will validate your data before saving

3. **Confirmation**
   - You'll see a success message if the save was successful
   - You'll be redirected back to the task list

## Deleting Tasks

### When to Delete
- Task is no longer needed
- Task was created by mistake
- Task has incorrect settings that can't be fixed by editing

### How to Delete

1. **Find the Task**
   - Navigate to the task list
   - Locate the task you want to delete

2. **Click Delete Button**
   - Click the trash icon (🗑️) in the Actions column
   - A confirmation dialog will appear

3. **Confirm Deletion**
   - Read the confirmation message carefully
   - Click "Delete" to proceed or "Cancel" to abort
   - **Warning**: This action cannot be undone

## Error Handling

### Common Error Messages

#### "Cannot edit task with current status"
- **What it means**: The task is currently running or has completed
- **Solution**: Wait for the task to finish, then try editing again

#### "Task not found"
- **What it means**: The task may have been deleted or the ID is invalid
- **Solution**: Refresh the page and check if the task still exists

#### "Network connection failed"
- **What it means**: There's an internet connectivity issue
- **Solution**: Check your internet connection and try again

#### "Validation failed"
- **What it means**: One or more form fields have invalid data
- **Solution**: Check the form for red error messages and fix them

### Recovery Options

When you encounter errors, the system provides recovery options:

- **Try Again**: Retry the operation
- **Refresh Page**: Reload the page to get fresh data
- **Go Back**: Return to the previous page
- **Retry When Online**: Queue the operation for when you're back online

## Best Practices

### Before Editing
1. **Check Task Status**: Only edit pending or error tasks
2. **Review Current Settings**: Understand what the task is currently configured to do
3. **Plan Your Changes**: Know what you want to modify before starting

### During Editing
1. **Save Frequently**: Don't leave unsaved changes for too long
2. **Validate Input**: Make sure all fields have valid values
3. **Test URLs**: Ensure the URLs you're adding are accessible

### After Editing
1. **Verify Changes**: Check that your modifications were saved correctly
2. **Monitor Progress**: Watch the task to ensure it runs as expected
3. **Check Results**: Review the extracted emails to ensure quality

## Troubleshooting

### Form Won't Load
- **Check**: Internet connection
- **Try**: Refreshing the page
- **If persists**: Contact support

### Can't Save Changes
- **Check**: All validation errors are resolved
- **Try**: Refreshing the page and trying again
- **If persists**: Check if the task status has changed

### Delete Button Not Available
- **Reason**: Task is currently running
- **Solution**: Wait for the task to complete or stop it first

### Error Messages Not Clear
- **Try**: Hovering over error messages for more details
- **Check**: The troubleshooting section above
- **Contact**: Support if the issue persists

## Keyboard Shortcuts

- **Esc**: Cancel current operation
- **Enter**: Confirm dialog or save form
- **Tab**: Navigate between form fields
- **Ctrl+S**: Save form (when available)

## Accessibility Features

- **Screen Reader Support**: All elements are properly labeled
- **Keyboard Navigation**: Full keyboard access to all features
- **High Contrast**: Compatible with high contrast themes
- **Focus Management**: Clear focus indicators

## Getting Help

### Documentation
- Check this user guide for common issues
- Review the troubleshooting section
- Read the FAQ if available

### Support
- Contact technical support for complex issues
- Provide error messages and steps to reproduce
- Include task ID and timestamp when reporting problems

## Feature Comparison

| Feature | Create New Task | Edit Existing Task |
|---------|----------------|-------------------|
| Task Status | Always "Pending" | Must be "Pending" or "Error" |
| Form Data | Empty form | Pre-populated with current data |
| Validation | Same rules | Same rules |
| Save Action | Creates new task | Updates existing task |
| Delete Action | N/A | Available for eligible tasks |

## Video Tutorials

### Basic Editing
1. Navigate to task list
2. Click edit button
3. Modify desired fields
4. Save changes

### Advanced Features
1. Bulk URL management
2. Proxy configuration
3. Advanced settings
4. Error recovery

### Troubleshooting
1. Common error messages
2. Recovery procedures
3. Best practices
4. Getting help

## FAQ

### Q: Can I edit a running task?
A: No, only pending or error tasks can be edited.

### Q: What happens if I delete a task?
A: The task and all its associated data (URLs, results, logs) are permanently removed.

### Q: Can I undo my changes?
A: No, once saved, changes cannot be undone. Make sure to review before saving.

### Q: Why can't I see the edit button?
A: The edit button only appears for tasks you have permission to edit and that are in an editable status.

### Q: How do I know if my changes were saved?
A: You'll see a success message and be redirected to the task list.

### Q: What if the form validation fails?
A: Fix the highlighted errors and try saving again.

### Q: Can I edit multiple tasks at once?
A: No, tasks must be edited one at a time.

### Q: What happens to the task results if I edit the task?
A: Existing results are preserved, but new extraction will use the updated settings. 