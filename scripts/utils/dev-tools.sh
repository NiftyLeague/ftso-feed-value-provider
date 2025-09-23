#!/bin/bash

# Development Tools Utility
# Provides common development tasks like build, lint, format, and validation

echo "🛠️ FTSO Development Tools"
echo "========================"

# Function to show usage
show_usage() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  build     - Build the application"
    echo "  lint      - Run linting (with optional --fix)"
    echo "  format    - Format code (with optional --check)"
    echo "  validate  - Run complete validation (format + lint + type check)"
    echo "  type      - Run TypeScript type checking"
    echo "  clean     - Clean build artifacts"
    echo "  help      - Show this help message"
    echo ""
    echo "Options:"
    echo "  --fix     - For lint: automatically fix issues"
    echo "  --check   - For format: only check, don't modify files"
    echo ""
    echo "Examples:"
    echo "  $0 build                # Build the application"
    echo "  $0 lint --fix           # Run linting and fix issues"
    echo "  $0 format --check       # Check formatting without changes"
    echo "  $0 validate             # Run complete validation suite"
}

# Function to build the application
build_app() {
    echo "🏗️ Building FTSO Feed Value Provider..."
    echo "======================================"
    
    # Clean previous build
    if [ -d "dist" ]; then
        echo "🧹 Cleaning previous build..."
        rm -rf dist
    fi
    
    # Run build
    echo "📦 Running build..."
    pnpm build
    
    if [ $? -eq 0 ]; then
        echo "✅ Build completed successfully"
        
        # Show build info
        if [ -d "dist" ]; then
            local size=$(du -sh dist | cut -f1)
            local files=$(find dist -type f | wc -l | tr -d ' ')
            echo "📊 Build output: $size ($files files)"
        fi
    else
        echo "❌ Build failed"
        return 1
    fi
}

# Function to run linting
run_lint() {
    local fix_mode=$1
    
    echo "🔍 Running ESLint..."
    echo "==================="
    
    if [ "$fix_mode" = "--fix" ]; then
        echo "🔧 Running with auto-fix enabled..."
        pnpm lint
    else
        echo "👀 Running in check-only mode..."
        pnpm lint:check
    fi
    
    if [ $? -eq 0 ]; then
        echo "✅ Linting passed"
    else
        echo "❌ Linting issues found"
        if [ "$fix_mode" != "--fix" ]; then
            echo "💡 Run with --fix to automatically fix issues: $0 lint --fix"
        fi
        return 1
    fi
}

# Function to format code
format_code() {
    local check_mode=$1
    
    echo "🎨 Running Prettier..."
    echo "====================="
    
    if [ "$check_mode" = "--check" ]; then
        echo "👀 Running in check-only mode..."
        pnpm format:check
    else
        echo "✏️ Formatting files..."
        pnpm format
    fi
    
    if [ $? -eq 0 ]; then
        echo "✅ Code formatting is correct"
    else
        echo "❌ Code formatting issues found"
        if [ "$check_mode" = "--check" ]; then
            echo "💡 Run without --check to fix formatting: $0 format"
        fi
        return 1
    fi
}

# Function to run type checking
run_type_check() {
    echo "🔍 Running TypeScript type checking..."
    echo "====================================="
    
    pnpm type:check
    
    if [ $? -eq 0 ]; then
        echo "✅ Type checking passed"
    else
        echo "❌ Type checking failed"
        return 1
    fi
}

# Function to run complete validation
run_validation() {
    echo "✅ Running Complete Validation Suite"
    echo "==================================="
    
    local failed=0
    
    echo ""
    echo "Phase 1: Code Formatting"
    echo "----------------------"
    format_code --check
    if [ $? -ne 0 ]; then
        failed=1
    fi
    
    echo ""
    echo "Phase 2: Linting"
    echo "---------------"
    run_lint
    if [ $? -ne 0 ]; then
        failed=1
    fi
    
    echo ""
    echo "Phase 3: Type Checking"
    echo "--------------------"
    run_type_check
    if [ $? -ne 0 ]; then
        failed=1
    fi
    
    echo ""
    echo "Validation Summary"
    echo "=================="
    
    if [ $failed -eq 0 ]; then
        echo "✅ All validation checks passed!"
        echo "🚀 Code is ready for commit/deployment"
    else
        echo "❌ Some validation checks failed"
        echo "🔧 Please fix the issues above before proceeding"
        return 1
    fi
}

# Function to clean build artifacts
clean_build() {
    echo "🧹 Cleaning build artifacts..."
    echo "============================="
    
    local cleaned=0
    
    # Remove dist directory
    if [ -d "dist" ]; then
        echo "📁 Removing dist/ directory..."
        rm -rf dist
        cleaned=1
    fi
    
    # Remove coverage directory
    if [ -d "coverage" ]; then
        echo "📊 Removing coverage/ directory..."
        rm -rf coverage
        cleaned=1
    fi
    
    # Remove node_modules/.cache if it exists
    if [ -d "node_modules/.cache" ]; then
        echo "💾 Removing node_modules/.cache..."
        rm -rf node_modules/.cache
        cleaned=1
    fi
    
    # Remove any .tsbuildinfo files
    if find . -name "*.tsbuildinfo" -type f | grep -q .; then
        echo "🔍 Removing TypeScript build info files..."
        find . -name "*.tsbuildinfo" -type f -delete
        cleaned=1
    fi
    
    if [ $cleaned -eq 1 ]; then
        echo "✅ Build artifacts cleaned"
    else
        echo "ℹ️ No build artifacts to clean"
    fi
}

# Parse command line arguments
COMMAND=$1
shift

# Parse options
FIX_MODE=""
CHECK_MODE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --fix)
            FIX_MODE="--fix"
            shift
            ;;
        --check)
            CHECK_MODE="--check"
            shift
            ;;
        *)
            echo "❌ Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Execute command
case $COMMAND in
    build)
        build_app
        ;;
    lint)
        run_lint "$FIX_MODE"
        ;;
    format)
        format_code "$CHECK_MODE"
        ;;
    validate)
        run_validation
        ;;
    type)
        run_type_check
        ;;
    clean)
        clean_build
        ;;
    help|--help|-h)
        show_usage
        ;;
    "")
        echo "❌ No command specified"
        echo ""
        show_usage
        exit 1
        ;;
    *)
        echo "❌ Unknown command: $COMMAND"
        echo ""
        show_usage
        exit 1
        ;;
esac