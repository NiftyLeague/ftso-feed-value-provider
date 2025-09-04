# Test Logging Control

This document describes the test logging control system that helps keep test
output clean and focused on actual failures.

## Overview

The test suite includes an intelligent log suppression system that filters out
expected error messages, debug output, and framework noise while preserving
actual test failures and unexpected errors.

## Features

### Automatic Log Suppression

The system automatically suppresses:

- **Expected Error Messages**: Connection failures, validation errors, and other
  expected test errors
- **NestJS Framework Messages**: Debug, info, and routine framework logs
- **WebSocket Noise**: Connection status messages, timeouts, and protocol
  messages
- **HTTP Error Responses**: Expected 4xx/5xx responses from test endpoints
- **Stack Traces**: Stack traces from expected test errors
- **Performance Messages**: Monitoring and performance degradation messages

### Configurable Behavior

Control logging behavior with environment variables:

```bash
# Default behavior - suppress expected logs
npm test

# Show all logs (verbose mode)
VERBOSE_TEST_LOGS=true npm test

# Disable log suppression entirely
SUPPRESS_TEST_LOGS=false npm test
```

## NPM Scripts

Convenient npm scripts are available for different logging modes:

```bash
# Standard test run with clean output
npm test

# Verbose logging (shows all logs)
npm run test:verbose

# No log suppression (shows expected errors)
npm run test:no-suppress

# Extra quiet mode (suppresses Jest output too)
npm run test:quiet
```

## Shell Script

Use the provided shell script for more control:

```bash
# Clean output (default)
./scripts/test-with-logs.sh

# Verbose logging
./scripts/test-with-logs.sh --verbose

# No suppression
./scripts/test-with-logs.sh --no-suppress

# Run specific tests with verbose logging
./scripts/test-with-logs.sh --verbose src/adapters/**/*.spec.ts

# Show help
./scripts/test-with-logs.sh --help
```

## Suppressed Log Patterns

The system recognizes and suppresses these types of messages:

### Error Messages

- `Cannot read properties of undefined`
- `Connection failed`
- `Validation failed`
- `Network error`
- `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`

### Framework Messages

- NestJS logger output: `[Nest] ... ERROR/WARN/DEBUG/LOG [Component]`
- WebSocket connection messages
- HTTP status and error responses

### Test-Specific Messages

- `TEST: Starting ... test`
- `... endpoint error:`
- Performance and monitoring alerts
- Stack trace lines from expected errors

### Object Output

- JSON objects with common test properties
- Empty lines and whitespace-only lines
- Numeric-only lines

## Customization

### Adding New Patterns

To suppress additional log patterns, edit `src/__tests__/test-setup.ts` and add
patterns to the `SUPPRESSED_LOG_PATTERNS` array:

```typescript
const SUPPRESSED_LOG_PATTERNS = [
  // Add your pattern here
  /Your custom pattern/,
  // ... existing patterns
];
```

### Temporary Debugging

For temporary debugging of a specific test, you can:

1. **Use verbose mode**: `VERBOSE_TEST_LOGS=true npm test -- your-test.spec.ts`
2. **Disable suppression**:
   `SUPPRESS_TEST_LOGS=false npm test -- your-test.spec.ts`
3. **Add console.log with a unique prefix** that won't be suppressed

### Environment Variables

| Variable             | Default | Description                           |
| -------------------- | ------- | ------------------------------------- |
| `SUPPRESS_TEST_LOGS` | `true`  | Enable/disable log suppression        |
| `VERBOSE_TEST_LOGS`  | `false` | Show all logs (overrides suppression) |
| `NODE_ENV`           | `test`  | Set to test mode automatically        |

## Best Practices

### When to Use Each Mode

- **Default mode**: Regular development and CI/CD
- **Verbose mode**: Debugging specific test failures
- **No suppression**: Investigating framework or infrastructure issues
- **Quiet mode**: Focus on test results only

### Writing Test-Friendly Code

When writing tests, consider:

1. **Use descriptive error messages** that won't be suppressed
2. **Avoid generic error messages** that might be filtered
3. **Use unique prefixes** for debug output you want to see
4. **Test error conditions explicitly** rather than relying on console output

### CI/CD Integration

For continuous integration, the default mode provides clean output while still
showing actual failures:

```yaml
# GitHub Actions example
- name: Run tests
  run: npm test
  env:
    NODE_ENV: test
    # SUPPRESS_TEST_LOGS: true (default)
```

For debugging CI failures, temporarily enable verbose mode:

```yaml
- name: Debug test failures
  run: npm run test:verbose
```

## Troubleshooting

### Logs Still Appearing

If expected logs are still appearing:

1. Check if the pattern is in `SUPPRESSED_LOG_PATTERNS`
2. Verify the pattern matches the exact log format
3. Test the pattern with a simple regex tester
4. Consider if the log is coming from a different source

### Important Logs Being Suppressed

If important logs are being suppressed:

1. Use verbose mode: `npm run test:verbose`
2. Check if the log matches an overly broad pattern
3. Refine the suppression patterns to be more specific
4. Use a unique prefix for important debug messages

### Performance Impact

The log suppression system has minimal performance impact:

- Pattern matching is optimized for common cases
- String operations are cached where possible
- Suppression can be disabled entirely if needed

## Examples

### Running Tests with Different Log Levels

```bash
# Clean output for regular development
npm test

# Debug a failing test
VERBOSE_TEST_LOGS=true npm test -- src/controllers/feed.controller.spec.ts

# Check for infrastructure issues
npm run test:no-suppress -- src/__tests__/integration/

# Focus on test results only
npm run test:quiet
```

### Customizing for Your Project

```typescript
// In test-setup.ts, add project-specific patterns
const PROJECT_SPECIFIC_PATTERNS = [
  /Your application error pattern/,
  /Custom framework messages/,
];

const SUPPRESSED_LOG_PATTERNS = [
  ...PROJECT_SPECIFIC_PATTERNS,
  // ... existing patterns
];
```

This system helps maintain clean, readable test output while preserving the
ability to debug when needed.
