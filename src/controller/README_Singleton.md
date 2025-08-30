# YellowPagesController Singleton Pattern Implementation

## Overview

The `YellowPagesController` has been refactored to implement the **Singleton Pattern**, ensuring that only one instance of the controller exists throughout the application lifecycle.

## Why Singleton Pattern?

The Singleton pattern is particularly beneficial for the `YellowPagesController` because:

1. **Resource Management**: Manages shared resources like browser instances, process managers, and database connections
2. **State Consistency**: Ensures consistent state across different parts of the application
3. **Memory Efficiency**: Prevents multiple instances from consuming unnecessary memory
4. **Centralized Control**: Provides a single point of control for Yellow Pages operations

## Implementation Details

### Key Components

```typescript
export class YellowPagesController {
    // Private static instance
    private static instance: YellowPagesController | null = null;
    
    // Private constructor prevents direct instantiation
    private constructor() { ... }
    
    // Public static method to get the singleton instance
    public static getInstance(): YellowPagesController { ... }
    
    // Utility methods for testing and cleanup
    public static resetInstance(): void { ... }
    public static hasInstance(): boolean { ... }
}
```

### Constructor Access

- **Before**: `new YellowPagesController()` was allowed
- **After**: Constructor is private, only `getInstance()` can be used

## Usage Examples

### Basic Usage

```typescript
// ✅ Correct way to get the controller
const controller = YellowPagesController.getInstance();

// Use the controller methods
const tasks = await controller.listTasks();
await controller.createTask(taskData);
```

### ❌ Incorrect Usage

```typescript
// ❌ This will cause a TypeScript error
const controller = new YellowPagesController(); // Error: Constructor is private
```

### Multiple References

```typescript
// Get multiple references (all point to the same instance)
const controller1 = YellowPagesController.getInstance();
const controller2 = YellowPagesController.getInstance();

console.log(controller1 === controller2); // true - same instance
```

## Testing and Development

### Instance Management

```typescript
// Check if an instance exists
const hasInstance = YellowPagesController.hasInstance();

// Reset instance for testing (use with caution)
YellowPagesController.resetInstance();

// Get fresh instance
const newController = YellowPagesController.getInstance();
```

### Testing Scenarios

```typescript
describe('YellowPagesController Singleton', () => {
    beforeEach(() => {
        // Reset singleton before each test
        YellowPagesController.resetInstance();
    });
    
    afterEach(() => {
        // Clean up after each test
        YellowPagesController.resetInstance();
    });
    
    it('should return the same instance', () => {
        const instance1 = YellowPagesController.getInstance();
        const instance2 = YellowPagesController.getInstance();
        expect(instance1).toBe(instance2);
    });
});
```

## Migration Guide

### Existing Code Changes

If you have existing code that creates `YellowPagesController` instances, update it:

```typescript
// ❌ Old way
const controller = new YellowPagesController();

// ✅ New way
const controller = YellowPagesController.getInstance();
```

### Service Classes

Update service classes that use the controller:

```typescript
export class TaskService {
    private controller: YellowPagesController;
    
    constructor() {
        // Get singleton instance instead of creating new one
        this.controller = YellowPagesController.getInstance();
    }
}
```

## Benefits

### 1. **Resource Efficiency**
- Single browser manager instance
- Single process manager instance
- Shared database connections

### 2. **State Consistency**
- Consistent task status across the application
- Unified process management
- Synchronized browser state

### 3. **Memory Management**
- Prevents memory leaks from multiple instances
- Efficient resource allocation
- Better garbage collection

### 4. **Centralized Control**
- Single point of control for Yellow Pages operations
- Easier debugging and monitoring
- Consistent error handling

## Considerations

### 1. **Thread Safety**
- The current implementation is not thread-safe
- If you need thread safety, consider using a mutex or lock mechanism

### 2. **Testing**
- Use `resetInstance()` carefully in tests
- Consider dependency injection for better testability

### 3. **Memory Cleanup**
- The singleton instance persists for the application lifetime
- Use `resetInstance()` only when absolutely necessary

## Best Practices

### 1. **Always use getInstance()**
```typescript
// ✅ Good
const controller = YellowPagesController.getInstance();

// ❌ Bad - will cause compilation error
const controller = new YellowPagesController();
```

### 2. **Handle Instance State**
```typescript
// Check if instance exists before using
if (YellowPagesController.hasInstance()) {
    const controller = YellowPagesController.getInstance();
    // Use controller
}
```

### 3. **Testing Cleanup**
```typescript
// Always reset in tests
beforeEach(() => YellowPagesController.resetInstance());
afterEach(() => YellowPagesController.resetInstance());
```

## Troubleshooting

### Common Issues

1. **TypeScript Error: Constructor is private**
   - Solution: Use `getInstance()` instead of `new`

2. **Instance not found**
   - Solution: Check if `hasInstance()` returns true

3. **Testing issues with persistent state**
   - Solution: Use `resetInstance()` in test setup/teardown

### Debug Information

```typescript
// Check singleton state
console.log('Has instance:', YellowPagesController.hasInstance());

// Get instance info
const controller = YellowPagesController.getInstance();
console.log('Controller instance:', controller);
```

## Future Enhancements

Consider these improvements for production use:

1. **Thread Safety**: Add mutex/lock mechanisms
2. **Lazy Initialization**: Initialize only when first accessed
3. **Configuration**: Make singleton behavior configurable
4. **Lifecycle Hooks**: Add initialization and cleanup hooks

## Conclusion

The Singleton pattern implementation provides a robust, efficient way to manage the `YellowPagesController` across your application. It ensures consistent behavior, efficient resource usage, and centralized control while maintaining the existing API surface.
