# Yellow Pages Controller

## Overview

The Yellow Pages Controller provides a comprehensive business logic layer for managing Yellow Pages scraping tasks in the aiFetchly application. It follows the same architectural pattern as other controllers in the system and integrates seamlessly with the existing infrastructure.

## Architecture

```
Frontend (Vue Components)
    ↓ (IPC Communication)
Main Process (Electron)
    ↓ (Controller)
YellowPagesController
    ├── YellowPagesModule (Core Business Logic)
    ├── YellowPagesTaskModule (Task Database Operations)
    ├── YellowPagesResultModule (Result Database Operations)
    ├── YellowPagesPlatformModule (Platform Management)
    ├── YellowPagesProcessManager (Multi-Process Operations)
    ├── BrowserManager (Puppeteer Instance Management)
    └── AccountCookiesModule (Authentication)
        ↓
Database Models & Process Management
```

## Key Features

- **Full CRUD Operations**: Create, Read, Update, Delete tasks
- **Task Control**: Start, Stop, Pause, Resume functionality
- **Progress Monitoring**: Real-time task progress tracking
- **Result Management**: Retrieve and export scraping results
- **Bulk Operations**: Perform actions on multiple tasks simultaneously
- **Health Monitoring**: System health and status information
- **Data Export**: Export results in JSON and CSV formats
- **Platform Management**: Manage different yellow pages platforms
- **Account Integration**: Support for authenticated scraping

## Module Architecture

### 1. YellowPagesController
The main controller that orchestrates all Yellow Pages operations and provides a clean API for the frontend.

### 2. YellowPagesTaskModule
Handles all task-related database operations:
- Task creation, reading, updating, and deletion
- Task listing with filtering and pagination
- Task status management
- Task statistics and reporting

### 3. YellowPagesResultModule
Manages scraping results:
- Result storage and retrieval
- Result filtering and search
- Result export (JSON/CSV)
- Result statistics and analytics

### 4. YellowPagesPlatformModule
Manages platform configurations:
- Platform CRUD operations
- Platform validation and settings
- Platform statistics and health

### 5. YellowPagesModule
Core business logic for:
- Task execution and management
- Process coordination
- Health monitoring
- Integration with other services

## Usage Examples

### Creating a Task
```typescript
const controller = YellowPagesController.getInstance();

const taskData: YellowPagesTaskData = {
    name: "Restaurant Search - NYC",
    platform: "yellowpages.com",
    keywords: ["restaurant", "pizza", "italian"],
    location: "New York, NY",
    max_pages: 10,
    concurrency: 2,
    delay_between_requests: 2000
};

const taskId = await controller.createTask(taskData);
```

### Starting a Task
```typescript
await controller.startTask(taskId);
```

### Getting Task Progress
```typescript
const progress = await controller.getTaskProgress(taskId);
console.log(`Task ${taskId} is ${progress.percentage}% complete`);
```

### Exporting Results
```typescript
// Export as JSON
const jsonResults = await controller.exportTaskResults(taskId, 'json');

// Export as CSV
const csvResults = await controller.exportTaskResults(taskId, 'csv');
```

### Bulk Operations
```typescript
const taskIds = [1, 2, 3, 4];
const results = await controller.bulkOperations('start', taskIds);
console.log(`Started ${results.successful} out of ${results.total} tasks`);
```

## IPC Integration

The controller is designed to work with Electron's IPC system. All operations are exposed through the `yellowPagesIpc.ts` file, which handles:

- Task CRUD operations
- Task control (start/stop/pause/resume)
- Progress monitoring
- Result retrieval and export
- Bulk operations
- System health and statistics

## Error Handling

The controller implements comprehensive error handling:
- Input validation for all operations
- Database operation error handling
- Process management error handling
- User-friendly error messages
- Detailed logging for debugging

## Performance Considerations

- **Database Operations**: Uses efficient database queries with proper indexing
- **Process Management**: Manages concurrent scraping processes efficiently
- **Memory Management**: Proper cleanup of resources and processes
- **Caching**: Implements caching for frequently accessed data

## Security Features

- **Input Validation**: All inputs are validated before processing
- **Authentication**: Integrates with account management system
- **Access Control**: Respects user permissions and account limits
- **Data Sanitization**: Prevents injection attacks and data corruption

## Testing

The controller is designed to be easily testable:
- Dependency injection for all external services
- Mockable interfaces for testing
- Clear separation of concerns
- Comprehensive error handling

## Dependencies

- **YellowPagesModule**: Core business logic
- **YellowPagesTaskModule**: Task database operations
- **YellowPagesResultModule**: Result database operations
- **YellowPagesPlatformModule**: Platform management
- **YellowPagesProcessManager**: Process management
- **BrowserManager**: Browser instance management
- **AccountCookiesModule**: Authentication and cookies
- **Database Models**: Data persistence

## Future Enhancements

- **Real-time Updates**: WebSocket integration for live progress updates
- **Advanced Filtering**: More sophisticated task and result filtering
- **Scheduling**: Advanced task scheduling and automation
- **Analytics**: Enhanced reporting and analytics capabilities
- **API Rate Limiting**: Intelligent rate limiting based on platform capabilities
- **Machine Learning**: AI-powered result validation and enhancement

## Contributing

When contributing to the Yellow Pages Controller:

1. Follow the existing code patterns and architecture
2. Maintain proper error handling and logging
3. Add comprehensive tests for new functionality
4. Update documentation for any API changes
5. Ensure backward compatibility when possible

## License

This controller is part of the aiFetchly project and follows the same licensing terms.
