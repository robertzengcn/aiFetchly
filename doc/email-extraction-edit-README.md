# Email Extraction Edit Functionality

## Overview

The email extraction edit functionality allows users to modify existing email extraction tasks that are in a pending or error state. This feature provides a complete CRUD (Create, Read, Update, Delete) interface for managing email extraction tasks.

## Features

### ✅ Completed Features

- **Task Editing**: Edit pending and error tasks with full form validation
- **Task Deletion**: Delete tasks with confirmation dialogs
- **Enhanced Error Handling**: User-friendly error messages with recovery options
- **Success Feedback**: Animated success notifications with undo functionality
- **Form Validation**: Comprehensive validation for all form fields
- **State Management**: Proper loading states and form dirty tracking
- **Security**: Input sanitization and permission validation
- **Testing**: Comprehensive unit tests for API, validation, and business logic

### 🔄 In Progress

- Performance optimization (caching, lazy loading)
- Accessibility improvements (ARIA labels, keyboard navigation)
- Internationalization support

## Architecture

### Backend Components

#### API Layer (`src/views/api/emailextraction.ts`)
- `getEmailSearchTask(taskId)`: Retrieve single task for editing
- `updateEmailSearchTask(taskId, data)`: Update task with new data
- `deleteEmailSearchTask(taskId)`: Delete task and associated data

#### Controller Layer (`src/controller/emailextractionController.ts`)
- `getEmailSearchTask()`: Business logic for task retrieval
- `updateEmailSearchTask()`: Validation and update logic
- `deleteEmailSearchTask()`: Deletion with cleanup

#### Module Layer (`src/modules/EmailSearchTaskModule.ts`)
- Database operations for task management
- Transaction handling for complex updates
- Related entity cleanup (URLs, proxies, results)

### Frontend Components

#### Form Components
- `src/views/pages/emailextraction/edit.vue`: Edit form component
- `src/views/pages/emailextraction/index.vue`: Enhanced create form
- `src/views/components/widgets/confirmDialog.vue`: Confirmation dialogs

#### Error Handling
- `src/views/utils/errorHandler.ts`: Enhanced error handling system
- `src/views/components/widgets/ErrorDisplay.vue`: Error display component
- `src/views/components/widgets/SuccessNotification.vue`: Success notifications

#### Table Components
- `src/views/pages/emailextraction/widgets/EmailResultTable.vue`: Enhanced task list table

## API Reference

### Get Task for Editing
```typescript
GET /api/email-search-task/:id
```
Returns complete task data including URLs and proxies for editing.

### Update Task
```typescript
PUT /api/email-search-task/:id
```
Updates task with new data. Only allowed for pending/error tasks.

### Delete Task
```typescript
DELETE /api/email-search-task/:id
```
Deletes task and all associated data. Only allowed for pending/error tasks.

## Usage Examples

### Editing a Task
```typescript
// Get task data
const task = await getEmailSearchTask(123)

// Update task
await updateEmailSearchTask(123, {
  urls: ['https://example.com'],
  pagelength: 10,
  concurrency: 2,
  processTimeout: 5,
  maxPageNumber: 100
})
```

### Error Handling
```typescript
try {
  await updateEmailSearchTask(taskId, data)
} catch (error) {
  // Error handler provides user-friendly messages
  errorHandler.addError({
    message: error.message,
    type: 'error',
    recoverable: true
  })
}
```

## Business Rules

### Task Status Validation
- **Editable**: `pending` (0), `error` (2)
- **Not Editable**: `running` (1), `completed` (3), `cancelled` (4)

### Form Validation Rules
- **URLs**: At least one valid URL required
- **Page Length**: 1-1000 pages
- **Concurrency**: 1-10 concurrent processes
- **Process Timeout**: 1-20 minutes
- **Max Page Number**: 0-1000 pages

### Security
- Task ownership validation
- Input sanitization
- CSRF protection
- Rate limiting

## Error Handling

### User-Friendly Messages
- Network errors: "Network connection failed. Please check your internet connection."
- Validation errors: "Please check your input and try again."
- Task errors: "Task not found.", "Cannot edit running task."

### Recovery Options
- Retry with exponential backoff
- Refresh page for load failures
- Go back for navigation errors
- Retry when online for offline errors

## Testing

### Unit Tests
- **API Tests**: `test/modules/emailextraction-api.test.ts`
- **Form Validation**: `test/modules/emailextraction-form.test.ts`
- **Business Logic**: `test/modules/emailextraction-business.test.ts`
- **Error Handling**: `test/modules/emailextraction-error.test.ts`

### Test Coverage
- API function calls and responses
- Form validation rules
- Business logic scenarios
- Error handling edge cases
- Permission validation

## Performance Considerations

### Optimizations Implemented
- Form field debouncing
- Loading states for better UX
- Optimistic updates where appropriate
- Error boundary for graceful failures

### Planned Optimizations
- Request caching
- Response compression
- Pagination for large datasets
- Lazy loading for related data

## Accessibility

### Current Features
- Keyboard shortcuts (Esc to cancel, Enter to confirm)
- Focus management
- Screen reader support
- Color contrast compliance

### Planned Improvements
- ARIA labels for all interactive elements
- Enhanced keyboard navigation
- RTL language support

## Internationalization

### Translation Keys
- Error messages
- Success notifications
- Form labels and validation messages
- Button text and tooltips

### Locale Support
- Date/time formatting
- Number formatting
- Cultural adaptations

## Migration Guide

### From Previous Version
1. No breaking changes to existing functionality
2. New edit routes available at `/emailextraction/edit/:id`
3. Enhanced error handling is backward compatible
4. New components are optional and can be gradually adopted

### Database Changes
- No schema changes required
- Existing task data remains compatible
- New audit logging for edit operations

## Troubleshooting

### Common Issues

#### "Cannot edit task with current status"
- **Cause**: Task is running or completed
- **Solution**: Wait for task to complete or create new task

#### "Task not found"
- **Cause**: Task ID is invalid or task was deleted
- **Solution**: Refresh task list and try again

#### "Network connection failed"
- **Cause**: Internet connection issues
- **Solution**: Check connection and retry

#### "Validation failed"
- **Cause**: Form data is invalid
- **Solution**: Check form fields and try again

### Debug Information
- Error logs available in task details
- Console logs for development debugging
- Network tab for API call inspection

## Contributing

### Development Setup
1. Clone the repository
2. Install dependencies: `yarn install`
3. Run tests: `yarn test`
4. Start development server: `yarn dev`

### Code Style
- Follow existing TypeScript patterns
- Use JSDoc comments for all public functions
- Write unit tests for new functionality
- Follow Vue.js composition API patterns

### Testing
- Run all tests: `yarn test`
- Run specific test suite: `yarn test emailextraction`
- Run with coverage: `yarn test --coverage`

## License

This functionality is part of the aiFetchly project and follows the same licensing terms. 