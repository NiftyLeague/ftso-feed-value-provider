# Git Hooks Setup

This project uses [Husky](https://typicode.github.io/husky/) and
[lint-staged](https://github.com/lint-staged/lint-staged) to enforce code
quality before commits.

## What's Configured

### Pre-commit Hook

Automatically runs on every commit to:

- ✅ Lint TypeScript/JavaScript files with ESLint (and auto-fix)
- ✅ Format all files with Prettier
- ✅ Only checks staged files (fast!)

**Files checked:**

- `*.{js,ts}` - Linted and formatted
- `*.{json,md,mdx,yml,yaml}` - Formatted only

### Commit Message Hook

Enforces [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>
```

**Valid types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `perf` - Performance improvements
- `test` - Adding or updating tests
- `build` - Build system changes
- `ci` - CI/CD changes
- `chore` - Other changes (dependencies, etc.)
- `revert` - Revert a previous commit

**Examples:**

```bash
git commit -m "feat: add Docker support"
git commit -m "fix: resolve authentication bug"
git commit -m "docs: update README with setup instructions"
git commit -m "feat(api): add new feed endpoint"
git commit -m "ci: add GitHub Actions workflow"
```

## Setup (Already Done)

The hooks are automatically installed when you run:

```bash
pnpm install
```

This triggers the `prepare` script which initializes Husky.

## How It Works

### Pre-commit Flow

```
1. You run: git commit
2. Husky intercepts the commit
3. lint-staged runs on staged files:
   - ESLint fixes issues
   - Prettier formats code
4. If all checks pass → commit succeeds
5. If checks fail → commit is blocked
```

### Commit Message Flow

```
1. You run: git commit -m "message"
2. Husky validates the message format
3. If valid → commit succeeds
4. If invalid → commit is blocked with helpful error
```

## Usage

### Normal Workflow

```bash
# Stage your changes
git add .

# Commit (hooks run automatically)
git commit -m "feat: add new feature"

# If hooks fail, fix the issues and try again
git add .
git commit -m "feat: add new feature"
```

### Bypassing Hooks (Not Recommended)

If you absolutely need to bypass hooks:

```bash
# Skip pre-commit hook
git commit --no-verify -m "feat: emergency fix"

# Or use the shorthand
git commit -n -m "feat: emergency fix"
```

**⚠️ Warning:** Only bypass hooks in emergencies. CI will still run all checks.

## Troubleshooting

### Hooks Not Running

**Check if Husky is installed:**

```bash
ls -la .husky/
```

You should see:

- `.husky/pre-commit`
- `.husky/commit-msg`

**Reinstall hooks:**

```bash
pnpm prepare
```

### Pre-commit Fails

**Common issues:**

1. **ESLint errors:**

   ```bash
   # Fix manually
   pnpm lint

   # Then commit again
   git add .
   git commit -m "fix: resolve linting issues"
   ```

2. **Prettier formatting:**

   ```bash
   # Format all files
   pnpm format

   # Then commit
   git add .
   git commit -m "style: format code"
   ```

3. **TypeScript errors:**

   ```bash
   # Check types
   pnpm type:check

   # Fix errors, then commit
   ```

### Commit Message Rejected

**Error:**

```
❌ Invalid commit message format!
```

**Solution:** Use the correct format:

```bash
# ❌ Wrong
git commit -m "added new feature"
git commit -m "Fixed bug"

# ✅ Correct
git commit -m "feat: add new feature"
git commit -m "fix: resolve authentication bug"
```

### Slow Pre-commit

lint-staged only checks **staged files**, so it should be fast. If it's slow:

1. **Check what's staged:**

   ```bash
   git status
   ```

2. **Stage only what you need:**

   ```bash
   git add src/specific-file.ts
   ```

3. **Avoid staging large files:**
   - Don't stage `node_modules/`
   - Don't stage `dist/`
   - These should be in `.gitignore`

## Configuration

### lint-staged Config

Located in `package.json`:

```json
{
  "lint-staged": {
    "*.{js,ts}": ["eslint --fix", "prettier --write"],
    "*.{json,md,mdx,yml,yaml}": ["prettier --write"]
  }
}
```

### Customizing

**Add more file types:**

```json
{
  "lint-staged": {
    "*.{js,ts}": ["eslint --fix", "prettier --write"],
    "*.{json,md,mdx,yml,yaml}": ["prettier --write"],
    "*.css": ["prettier --write"],
    "*.sh": ["shellcheck"]
  }
}
```

**Add more checks:**

```json
{
  "lint-staged": {
    "*.{js,ts}": [
      "eslint --fix",
      "prettier --write",
      "jest --bail --findRelatedTests"
    ]
  }
}
```

## CI Integration

The same checks run in CI (GitHub Actions):

**Local (pre-commit):**

- ESLint
- Prettier
- (Fast, only staged files)

**CI (on PR):**

- ESLint
- Prettier
- TypeScript type checking
- Build
- Tests
- (Comprehensive, all files)

This ensures:

- ✅ Fast feedback locally
- ✅ Comprehensive checks in CI
- ✅ No broken code reaches main

## Best Practices

### 1. Commit Often

Small, focused commits are easier to review:

```bash
# ✅ Good
git commit -m "feat: add user authentication"
git commit -m "test: add auth tests"
git commit -m "docs: update auth documentation"

# ❌ Avoid
git commit -m "feat: add everything"
```

### 2. Use Descriptive Messages

```bash
# ✅ Good
git commit -m "fix: resolve race condition in cache invalidation"

# ❌ Avoid
git commit -m "fix: bug"
```

### 3. Stage Intentionally

```bash
# Stage specific files
git add src/auth.ts src/auth.test.ts

# Review what's staged
git diff --staged

# Commit
git commit -m "feat: add authentication module"
```

### 4. Fix Issues Before Committing

```bash
# Run checks manually first
pnpm validate

# Then commit
git commit -m "feat: add new feature"
```

## Scripts Reference

```bash
# Format all files
pnpm format

# Check formatting
pnpm format:check

# Lint and fix
pnpm lint

# Check linting
pnpm lint:check

# Type check
pnpm type:check

# Run all checks
pnpm validate

# Reinstall hooks
pnpm prepare
```

## Disabling Hooks (Team Decision)

If your team decides to disable hooks:

**Remove from package.json:**

```json
{
  "scripts": {
    "prepare": "husky" // Remove this line
  }
}
```

**Delete hooks:**

```bash
rm -rf .husky
```

**Note:** CI will still run all checks, so you'll catch issues there.

## Resources

- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged Documentation](https://github.com/lint-staged/lint-staged)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [ESLint](https://eslint.org/)
- [Prettier](https://prettier.io/)
