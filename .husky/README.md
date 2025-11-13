# Husky Git Hooks

This directory contains Git hooks managed by Husky.

## Hooks

- **pre-commit** - Runs lint-staged to check and format code before commit
- **commit-msg** - Validates commit message follows Conventional Commits format

## Documentation

See [GIT-HOOKS.md](../GIT-HOOKS.md) for complete documentation.

## Quick Reference

### Valid Commit Messages

```bash
feat: add new feature
fix: resolve bug
docs: update documentation
style: format code
refactor: restructure code
perf: improve performance
test: add tests
build: update build config
ci: update CI workflow
chore: update dependencies
```

### Bypass Hooks (Emergency Only)

```bash
git commit --no-verify -m "feat: emergency fix"
```

# Test
