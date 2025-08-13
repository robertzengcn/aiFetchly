# Yellow Pages Scraper API Documentation

## Overview

The Yellow Pages Scraper API provides comprehensive CRUD operations for managing web scraping tasks across multiple yellow pages platforms. This API integrates with the existing aiFetchly infrastructure and supports multi-process scraping operations.

**Base URL:** `/api/yellow-pages`

## Authentication

All API endpoints require proper authentication. Include your authentication token in the request headers:

```
Authorization: Bearer <your-token>
```

## API Endpoints

### 1. Task Management

#### Create Task
**POST** `/api/yellow-pages/tasks`

Creates a new Yellow Pages scraping task.

**Request Body:**
```json
{
  "name": "Restaurant Search - NYC",
  "platform": "yellowpages.com",
  "keywords": ["restaurant", "pizza", "italian"],
  "location": "New York, NY",
  "max_pages": 10,
  "concurrency": 2,
  "account_id": 123,
  "proxy_config": {
    "host": "proxy.example.com",
    "port": 8080,
    "username": "user",
    "password": "pass"
  },
  "delay_between_requests": 2000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages task created successfully",
  "data": {
    "taskId": 456,
    "task": { ... }
  }
}
```

#### List Tasks
**GET** `/api/yellow-pages/tasks`

Retrieves a list of all Yellow Pages tasks with optional filtering.

**Query Parameters:**
- `offset` (optional): Number of tasks to skip (default: 0)
- `limit` (optional): Maximum number of tasks to return (default: 50)
- `status` (optional): Filter by task status
- `platform` (optional): Filter by platform
- `search` (optional): Search in task names and descriptions

**Example:**
```
GET /api/yellow-pages/tasks?status=running&platform=yellowpages.com&limit=20
```

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages tasks retrieved successfully",
  "data": {
    "tasks": [
      {
        "id": 456,
        "name": "Restaurant Search - NYC",
        "platform": "yellowpages.com",
        "status": "running",
        "created_at": "2024-01-15T10:30:00Z",
        "completed_at": null,
        "results_count": 156,
        "progress_percentage": 65
      }
    ],
    "total": 1,
    "filters": { ... }
  }
}
```

#### Get Task
**GET** `/api/yellow-pages/tasks/:id`

Retrieves detailed information about a specific task.

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages task retrieved successfully",
  "data": {
    "taskId": 456,
    "status": "running",
    "progress": {
      "taskId": 456,
      "status": "running",
      "currentPage": 7,
      "totalPages": 10,
      "resultsCount": 156,
      "percentage": 70,
      "estimatedTimeRemaining": 1800000,
      "startTime": "2024-01-15T10:30:00Z",
      "lastUpdateTime": "2024-01-15T11:45:00Z"
    }
  }
}
```

#### Update Task
**PUT** `/api/yellow-pages/tasks/:id`

Updates an existing task with new information.

**Request Body:**
```json
{
  "name": "Updated Restaurant Search - NYC",
  "max_pages": 15,
  "delay_between_requests": 3000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages task updated successfully",
  "data": {
    "taskId": 456,
    "updates": { ... }
  }
}
```

#### Delete Task
**DELETE** `/api/yellow-pages/tasks/:id`

Deletes a task and all associated results.

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages task deleted successfully",
  "data": {
    "taskId": 456
  }
}
```

### 2. Task Control Operations

#### Start Task
**POST** `/api/yellow-pages/tasks/:id/start`

Starts a paused or pending task.

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages task started successfully",
  "data": {
    "taskId": 456
  }
}
```

#### Stop Task
**POST** `/api/yellow-pages/tasks/:id/stop`

Stops a running task and marks it as paused.

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages task stopped successfully",
  "data": {
    "taskId": 456
  }
}
```

#### Pause Task
**POST** `/api/yellow-pages/tasks/:id/pause`

Pauses a running task.

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages task paused successfully",
  "data": {
    "taskId": 456
  }
}
```

#### Resume Task
**POST** `/api/yellow-pages/tasks/:id/resume`

Resumes a paused task.

**Response:**
```json
{
  "success": true,
  "message": "Yellow Pages task resumed successfully",
  "data": {
    "taskId": 456
  }
}
```

### 3. Task Information Operations

#### Get Task Progress
**GET** `/api/yellow-pages/tasks/:id/progress`

Retrieves detailed progress information for a specific task.

**Response:**
```json
{
  "success": true,
  "message": "Task progress retrieved successfully",
  "data": {
    "taskId": 456,
    "status": "running",
    "currentPage": 7,
    "totalPages": 10,
    "resultsCount": 156,
    "percentage": 70,
    "estimatedTimeRemaining": 1800000,
    "startTime": "2024-01-15T10:30:00Z",
    "lastUpdateTime": "2024-01-15T11:45:00Z",
    "errorMessage": null
  }
}
```

#### Get Task Results
**GET** `/api/yellow-pages/tasks/:id/results`

Retrieves all scraped results for a specific task.

**Response:**
```json
{
  "success": true,
  "message": "Task results retrieved successfully",
  "data": {
    "taskId": 456,
    "results": [
      {
        "id": 789,
        "task_id": 456,
        "business_name": "Joe's Pizza",
        "email": "info@joespizza.com",
        "phone": "+1-555-123-4567",
        "website": "https://joespizza.com",
        "address": {
          "street": "123 Main St",
          "city": "New York",
          "state": "NY",
          "zip": "10001",
          "country": "USA"
        },
        "social_media": ["https://facebook.com/joespizza", "https://twitter.com/joespizza"],
        "categories": ["Pizza", "Italian", "Restaurant"],
        "business_hours": {
          "monday": "11:00 AM - 10:00 PM",
          "tuesday": "11:00 AM - 10:00 PM"
        },
        "description": "Authentic Italian pizza since 1985",
        "rating": 4.5,
        "review_count": 127,
        "scraped_at": "2024-01-15T11:45:00Z",
        "platform": "yellowpages.com"
      }
    ],
    "total": 1
  }
}
```

#### Export Task Results
**GET** `/api/yellow-pages/tasks/:id/export`

Exports task results in various formats for download.

**Query Parameters:**
- `format` (optional): Export format - "json" or "csv" (default: "json")

**Example:**
```
GET /api/yellow-pages/tasks/456/export?format=csv
```

**Response:** File download with appropriate headers.

### 4. Bulk Operations

#### Bulk Task Operations
**POST** `/api/yellow-pages/tasks/bulk`

Performs operations on multiple tasks simultaneously.

**Request Body:**
```json
{
  "operation": "start",
  "taskIds": [456, 457, 458]
}
```

**Supported Operations:**
- `start`: Start multiple tasks
- `stop`: Stop multiple tasks
- `pause`: Pause multiple tasks
- `delete`: Delete multiple tasks

**Response:**
```json
{
  "success": true,
  "message": "Bulk operation completed. 3 successful, 0 failed.",
  "data": {
    "operation": "start",
    "total": 3,
    "successful": 3,
    "failed": 0,
    "results": [
      { "taskId": 456, "success": true },
      { "taskId": 457, "success": true },
      { "taskId": 458, "success": true }
    ]
  }
}
```

### 5. System Operations

#### Health Status
**GET** `/api/yellow-pages/health`

Retrieves system health and status information.

**Response:**
```json
{
  "success": true,
  "message": "Health status retrieved successfully",
  "data": {
    "totalTasks": 25,
    "activeTasks": 3,
    "completedTasks": 20,
    "failedTasks": 2,
    "processHealth": {
      "activeProcesses": 3,
      "memoryUsage": "1.2GB",
      "cpuUsage": "15%"
    }
  }
}
```

## Data Models

### YellowPagesTaskData
```typescript
interface YellowPagesTaskData {
  name: string;
  platform: string;
  keywords: string[];
  location: string;
  max_pages?: number;
  concurrency?: number;
  account_id?: number;
  proxy_config?: ProxyConfig;
  delay_between_requests?: number;
}
```

### TaskStatus
```typescript
enum TaskStatus {
  Pending = 'pending',
  InProgress = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Paused = 'paused'
}
```

### TaskProgress
```typescript
interface TaskProgress {
  taskId: number;
  status: TaskStatus;
  currentPage: number;
  totalPages: number;
  resultsCount: number;
  percentage: number;
  estimatedTimeRemaining?: number;
  startTime?: Date;
  lastUpdateTime: Date;
  errorMessage?: string;
}
```

### YellowPagesResult
```typescript
interface YellowPagesResult {
  id: number;
  task_id: number;
  business_name: string;
  email?: string;
  phone?: string;
  website?: string;
  address: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  social_media?: string[];
  categories?: string[];
  business_hours?: object;
  description?: string;
  rating?: number;
  review_count?: number;
  scraped_at: Date;
  platform: string;
  raw_data?: object;
  fax_number?: string;
  contact_person?: string;
  year_established?: number;
  number_of_employees?: string;
  payment_methods?: string[];
  specialties?: string[];
}
```

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `201`: Created
- `400`: Bad Request (validation errors)
- `404`: Not Found
- `500`: Internal Server Error

## Rate Limiting

The API implements rate limiting to prevent abuse:
- **Default Limit:** 100 requests per hour per user
- **Burst Limit:** 10 requests per minute
- **Headers:** Rate limit information is included in response headers

## Examples

### Complete Task Lifecycle

1. **Create Task:**
```bash
curl -X POST http://localhost:3000/api/yellow-pages/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Coffee Shops - San Francisco",
    "platform": "yelp.com",
    "keywords": ["coffee", "cafe", "espresso"],
    "location": "San Francisco, CA",
    "max_pages": 5
  }'
```

2. **Start Task:**
```bash
curl -X POST http://localhost:3000/api/yellow-pages/tasks/456/start \
  -H "Authorization: Bearer <token>"
```

3. **Monitor Progress:**
```bash
curl http://localhost:3000/api/yellow-pages/tasks/456/progress \
  -H "Authorization: Bearer <token>"
```

4. **Get Results:**
```bash
curl http://localhost:3000/api/yellow-pages/tasks/456/results \
  -H "Authorization: Bearer <token>"
```

5. **Export Results:**
```bash
curl http://localhost:3000/api/yellow-pages/tasks/456/export?format=csv \
  -H "Authorization: Bearer <token>" \
  -o results.csv
```

## Integration Notes

- **Multi-Process Architecture:** The API supports concurrent scraping tasks through child processes
- **Real-time Updates:** Progress updates are available through the progress endpoint
- **Platform Extensibility:** New platforms can be added through configuration
- **Cookie Management:** Integrates with existing account cookies system
- **Proxy Support:** Supports proxy rotation for rate limiting compliance
- **Scheduling:** Can be integrated with existing cron-based scheduling system

## Support

For API support and questions, please refer to the project documentation or contact the development team.
