#!/bin/bash

# FTSO Scripts Runner - Convenience script for common operations
# Provides easy access to the most frequently used debugging and testing scripts

# Set up signal handling for proper cleanup
cleanup_on_signal() {
    echo ""
    echo "🛑 Received interrupt signal, cleaning up..."
    # Kill any child processes
    jobs -p | xargs -r kill 2>/dev/null || true
    # Cleanup any hanging test processes
    pkill -f "jest\|pnpm.*jest" 2>/dev/null || true
    echo "✅ Cleanup completed"
    exit 130
}

# Trap signals
trap cleanup_on_signal INT TERM

echo "🔧 FTSO Scripts Runner"
echo "================================================================================"

# Function to show usage
show_usage() {
    echo "Usage: $0 [category] [script] [options]"
    echo ""
    echo "Categories:"
    echo "  debug     - Run debugging scripts"
    echo "  test      - Run testing scripts"
    echo "  utils     - Run utility scripts"
    echo ""
    echo "Quick Commands:"
    echo "  $0 debug all           # Run complete system analysis"
    echo "  $0 debug startup       # Debug startup issues"
    echo "  $0 debug websockets    # Monitor WebSocket connections"
    echo "  $0 debug performance   # Analyze system performance"
    echo "  $0 debug feeds         # Check feed data quality"
    echo "  $0 debug errors        # Analyze error patterns"
    echo ""
    echo "  $0 test readiness      # Test system readiness (production-grade)"
    echo "  $0 test server         # Test server functionality"
    echo "  $0 test all            # Run all test scripts (readiness, server, security, load, etc.)"
    echo "  $0 test jest           # Run all Jest tests"
    echo "  $0 test unit           # Run Jest unit tests"
    echo "  $0 test integration    # Run Jest integration tests"
    echo "  $0 test accuracy       # Run Jest accuracy tests"
    echo "  $0 test performance    # Run Jest performance tests"
    echo "  $0 test endurance      # Run Jest endurance tests"
    echo "  $0 test validate       # Validate all Jest tests (multiple runs)"
    echo "  $0 test shutdown       # Test graceful shutdown"
    echo ""
    echo "  $0 utils audit help    # Show audit system options"
    echo "  $0 utils audit analyze # Analyze existing logs"
    echo "  $0 utils audit status  # Show system status"
    echo "  $0 utils tickers       # Generate feeds from exchange tickers"
    echo "  $0 utils tickers --feeds-only # Generate feeds only (skip exchange fetch)"
    echo ""
    echo "Examples:"
    echo "  $0 debug all                    # Complete system analysis"
    echo "  $0 test readiness               # Test system readiness (production-grade)"
    echo "  $0 test server                  # Test server endpoints"
    echo "  $0 test all                     # Run all test scripts"
    echo "  $0 test jest                    # Run all Jest tests"
    echo "  $0 test validate                # Validate all Jest tests"
    echo "  $0 test accuracy                # Run Jest accuracy tests"
    echo "  $0 test performance             # Run Jest performance tests"
    echo "  $0 utils audit clean           # Clean old audit files"
    echo "  $0 utils tickers                # Generate feeds from exchange tickers"
    echo "  $0 utils tickers --feeds-only   # Generate feeds only (skip exchange fetch)"
    echo ""
    echo "For detailed help on any script, run it directly:"
    echo "  ./scripts/debug/startup.sh"
    echo "  ./scripts/utils/audit.sh help"
}

# Check if no arguments provided
if [ $# -eq 0 ]; then
    show_usage
    exit 1
fi

CATEGORY=$1
SCRIPT=$2
shift 2  # Remove category and script from arguments

# Validate category
case $CATEGORY in
    debug|test|utils)
        ;;
    help|--help|-h)
        show_usage
        exit 0
        ;;
    *)
        echo "❌ Unknown category: $CATEGORY"
        echo ""
        show_usage
        exit 1
        ;;
esac

# Handle special cases and script name mapping
case $SCRIPT in
    shutdown)
        SCRIPT="shutdown"
        ;;
    audit)
        # For utils audit, we need to handle the subcommand
        if [ "$CATEGORY" = "utils" ]; then
            # Pass all remaining arguments to the audit script
            exec ./scripts/utils/audit.sh "$@"
        fi
        ;;
    tickers)
        # For utils tickers, we need to handle the subcommand
        if [ "$CATEGORY" = "utils" ]; then
            # Pass all remaining arguments to the new tickers generation script
            exec ./scripts/tickers/generate.sh "$@"
        fi
        ;;
    # Handle Jest test runner commands
    unit|integration|accuracy|performance|endurance)
        if [ "$CATEGORY" = "test" ]; then
            # Use direct execution instead of exec to preserve signal handling
            ./scripts/test/runner.sh "$SCRIPT" false "$@"
            exit $?
        fi
        ;;
    # Handle Jest test runner for all tests
    jest)
        if [ "$CATEGORY" = "test" ]; then
            # Run all Jest tests via the test runner
            ./scripts/test/runner.sh all false "$@"
            exit $?
        fi
        ;;
    validate)
        if [ "$CATEGORY" = "test" ]; then
            # Handle validate - defaults to all Jest tests with validation
            ./scripts/test/runner.sh all true "$@"
            exit $?
        fi
        ;;
    # Handle 'all' - run all test scripts (server.sh, security.sh, etc.)
    all)
        if [ "$CATEGORY" = "test" ]; then
            # Run the comprehensive test scripts (not Jest tests)
            exec ./scripts/test/all.sh "$@"
        fi
        ;;
esac



# Check if script name is provided
if [ -z "$SCRIPT" ]; then
    echo "❌ No script specified for category: $CATEGORY"
    echo ""
    echo "Available scripts in $CATEGORY:"
    ls -1 "scripts/$CATEGORY/" | sed 's/\.sh$//' | sed 's/^/  /'
    exit 1
fi

# Construct script path
SCRIPT_PATH="scripts/$CATEGORY/$SCRIPT.sh"

# Check if script exists
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "❌ Script not found: $SCRIPT_PATH"
    echo ""
    echo "Available scripts in $CATEGORY:"
    ls -1 "scripts/$CATEGORY/" | sed 's/\.sh$//' | sed 's/^/  /'
    exit 1
fi

# Make sure script is executable
chmod +x "$SCRIPT_PATH"

# Run the script with any remaining arguments
echo "🚀 Running: $SCRIPT_PATH"
echo "Arguments: $*"
echo ""

exec "./$SCRIPT_PATH" "$@"