# Test Logging Control

## Overview

The test suite now includes a comprehensive logging control system that
suppresses all console output by default, providing clean test output while
allowing specific tests to enable logging when needed.

## Default Behavior

By default, **all logs are suppressed** during test execution:

- `console.log()`, `console.error()`, `console.warn()`, `console.debug()`
- NestJS logger output
- Process stdout/stderr writes

This ensures clean, readable test output without noise from expected error
messages, debug logs, or framework output.

## Enabling Logs for Specific Tests

### Method 1: Direct Control

```typescript
import { enableLoggingForTest, disableLoggingForTest } from "@/__tests__/utils";

describe("My Test", () => {
  it("should show logs when needed", () => {
    enableLoggingForTest();

    // These will now be visible
    console.log("Debug information");
    console.error("Error details");

    // Your test logic here
    expect(something).toBe(true);

    disableLoggingForTest(); // Clean up
  });
});
```

### Method 2: Wrapper Functions

```typescript
import { withLogging, withLoggingAsync } from "@/__tests__/utils";

describe("My Test", () => {
  it("should show logs with wrapper", () => {
    withLogging(() => {
      // These will be visible
      console.log("Debug information");
      console.error("Error details");

      // Your test logic here
      expect(something).toBe(true);
    });
    // Logging automatically disabled after wrapper
  });

  it("should work with async tests", async () => {
    await withLoggingAsync(async () => {
      // These will be visible
      console.log("Debug information");

      // Your async test logic here
      await someAsyncOperation();
      expect(something).toBe(true);
    });
    // Logging automatically disabled after wrapper
  });
});
```

### Method 3: Global Functions

```typescript
describe("My Test", () => {
  it("should show logs with global functions", () => {
    // Enable logging globally
    (global as any).enableTestLogging();

    console.log("This will be visible");

    // Disable logging globally
    (global as any).disableTestLogging();

    console.log("This will be suppressed");
  });
});
```

## Best Practices

### 1. Use Wrapper Functions

Prefer `withLogging()` and `withLoggingAsync()` as they automatically handle
cleanup:

```typescript
// ✅ Good
it("should test something", () => {
  withLogging(() => {
    console.log("Debug info");
    // test logic
  });
});

// ❌ Avoid (manual cleanup required)
it("should test something", () => {
  enableLoggingForTest();
  console.log("Debug info");
  // test logic
  disableLoggingForTest(); // Easy to forget
});
```

### 2. Enable Logs Only When Needed

Only enable logging for tests that actually need to debug output:

```typescript
// ✅ Good - only when debugging
it("should handle complex error scenarios", () => {
  withLogging(() => {
    // This test needs to see error logs
    expect(() => {
      someOperationThatLogsErrors();
    }).toThrow();
  });
});

// ❌ Avoid - unnecessary logging
it("should return correct value", () => {
  withLogging(() => {
    // This test doesn't need logs
    expect(calculateValue()).toBe(42);
  });
});
```

### 3. Clean Up in afterEach

If you use direct control, ensure cleanup in `afterEach`:

```typescript
describe("My Test Suite", () => {
  afterEach(() => {
    disableLoggingForTest(); // Ensure clean state
  });

  it("should test something", () => {
    enableLoggingForTest();
    // test logic
  });
});
```

## Examples

### Debugging Connection Issues

```typescript
it("should handle WebSocket connection failures", () => {
  withLogging(() => {
    const adapter = new WebSocketAdapter();

    // This will show connection error logs
    expect(() => {
      adapter.connect("invalid-url");
    }).toThrow();
  });
});
```

### Testing Error Handling

```typescript
it("should log appropriate error messages", () => {
  withLogging(() => {
    const service = new MyService();

    // This will show the error logs we want to verify
    expect(() => {
      service.performOperation();
    }).toThrow();
  });
});
```

### Performance Testing

```typescript
it("should complete within time limit", async () => {
  await withLoggingAsync(async () => {
    const start = Date.now();

    // This will show performance-related logs
    await performHeavyOperation();

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(1000);
  });
});
```

## Migration Guide

If you have existing tests that need logging:

1. **Identify tests that need logging** - Look for tests that currently show
   important output
2. **Wrap with logging control** - Use `withLogging()` or `withLoggingAsync()`
3. **Remove manual log suppression** - No need for complex log filtering
   patterns
4. **Test the changes** - Ensure logs appear when expected and are suppressed
   otherwise

## Benefits

- **Clean test output** by default
- **Selective logging** when debugging
- **No performance impact** when logging is disabled
- **Easy to use** with simple wrapper functions
- **Automatic cleanup** prevents test pollution
- **Consistent behavior** across all test types
