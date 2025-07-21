# Video Controller Tests

This directory contains tests for the VideoController, specifically testing the `videoDownloadtasklist` method.

## Test Files

### `videoController.test.ts`
Comprehensive unit tests for the `videoDownloadtasklist` method with the following test cases:

- **Empty list handling**: Tests when no video download tasks exist
- **Data transformation**: Tests proper transformation of task data with details
- **Missing task details**: Tests graceful handling when task details are missing
- **Optional fields**: Tests handling of null/undefined optional fields
- **Pagination**: Tests correct pagination parameter passing
- **Error handling**: Tests database error scenarios
- **Conversion errors**: Tests download type conversion error handling

### `videoControllerIntegration.test.ts`
Simple integration tests to verify:
- VideoController instantiation
- Method existence and signature validation

## Running the Tests

### Run all main tests:
```bash
yarn testmain
```

### Run specific video controller tests:
```bash
yarn testmain --run videoController.test.ts
```

### Run integration tests only:
```bash
yarn testmain --run videoControllerIntegration.test.ts
```

## Test Structure

The tests use Vitest as the testing framework with the following features:

- **Mocking**: Uses `vi.mock()` to mock dependencies
- **Setup/Teardown**: Uses `beforeEach()` and `afterEach()` for test isolation
- **Async testing**: Properly handles async operations
- **Error testing**: Tests both success and error scenarios

## Dependencies

The tests mock the following modules:
- `VideoDownloadTaskModule`
- `VideoDownloadTaskDetailModule`

## Test Data

The tests use realistic mock data that matches the expected structure:
- Video download task entities
- Task detail entities
- Various task statuses and download types

## Coverage

The tests cover:
- ✅ Happy path scenarios
- ✅ Edge cases (null/undefined values)
- ✅ Error conditions
- ✅ Data transformation logic
- ✅ Method parameter validation 