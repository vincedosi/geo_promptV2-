---
name: production-clean-code
description: Enforce production-grade code quality. Use whenever generating code for production, APIs, features for dev handoff, or any deliverable that must pass code review. Ensures JSDoc documentation, TypeScript strict typing, comprehensive tests (>80% coverage), linting, formatting, error handling, and no debug code. Apply to Node.js, React, full-stack—any production code.
---

# Production-Clean Code

Generate code that passes code review and runs reliably in production.

## Standards Applied

### 1. Documentation (Required)

Every function gets complete JSDoc:

```javascript
/**
 * Validates and creates a new user in the database.
 * 
 * @param {string} email - User's email (must be unique)
 * @param {string} password - Raw password (will be hashed)
 * @param {Object} options - Optional configuration
 * @param {number} [options.maxAttempts=3] - Max login attempts
 * @returns {Promise<User>} Created user (password excluded)
 * @throws {ValidationError} If email invalid or exists
 * @throws {DatabaseError} If write fails
 * 
 * @example
 * const user = await createUser('john@example.com', 'Pass123!');
 */
async function createUser(email, password, options = {}) {
  // implementation
}
```

Rules:
- ✅ JSDoc for all public functions
- ✅ @param with type and description
- ✅ @returns with type
- ✅ @throws for each error case
- ✅ @example with realistic usage
- ❌ No console.log, debugger, commented code
- ❌ Comments explain WHY, not WHAT

### 2. TypeScript Strict

```typescript
// tsconfig.json: "strict": true

// Good ✅
function greet(name: string): void {
  console.log(`Hello, ${name}`);
}

// Bad ❌
function greet(name) { }                    // implicit any
function process(data: any) { }             // any type
const x = async () => {};                   // no return type
```

- ✅ Strict mode enabled
- ✅ No `any` types
- ✅ Explicit return types
- ✅ All parameters typed
- ❌ Implicit any forbidden

### 3. Testing (Jest)

```typescript
describe('createUser', () => {
  // Happy path
  it('should create user with valid data', async () => {
    const user = await createUser('john@example.com', 'Pass123!');
    expect(user.id).toBeDefined();
    expect(user.email).toBe('john@example.com');
  });

  // Edge cases
  it('should reject duplicate email', async () => {
    await createUser('john@example.com', 'Pass123!');
    await expect(createUser('john@example.com', 'Other'))
      .rejects.toThrow(ValidationError);
  });

  it('should reject short password', async () => {
    await expect(createUser('john@example.com', 'short'))
      .rejects.toThrow(ValidationError);
  });

  // Security
  it('should hash password before storing', async () => {
    const user = await createUser('john@example.com', 'PlainPass123');
    expect(user.password).not.toBe('PlainPass123');
  });
});
```

Requirements:
- ✅ Tests for happy path + edge cases
- ✅ Coverage >80% minimum
- ✅ Test error conditions
- ✅ Verify security (hashing, validation)
- ❌ No untested code paths

### 4. Code Quality Gates

Run these before commit:

```bash
npm run lint -- --fix           # Fix style issues
npm run format                  # Auto-format code
npm run type-check              # TypeScript strict
npm test -- --coverage          # Tests + coverage
npm run build                   # Ensure compiles
```

Each must pass. Set up pre-commit hook:

```bash
#!/bin/bash
npm run lint || exit 1
npm run format:check || exit 1
npm run type-check || exit 1
npm test || exit 1
```

### 5. Code Style

**Naming:**
```typescript
const userEmail = 'john@example.com';       // camelCase
function validateEmail(email: string) { }   // camelCase
class UserService { }                       // PascalCase
const MAX_RETRIES = 3;                      // UPPER_SNAKE_CASE
```

**Functions:**
- Max 20 lines per function
- Single responsibility
- Descriptive names (no x, temp, data2)
- Avoid boolean parameters

```typescript
// Bad ❌
function createUser(email, pass, true, false, 3) { }

// Good ✅
function createUser(
  email: string,
  password: string,
  options?: {
    requireEmail?: boolean;
    sendWelcome?: boolean;
    maxAttempts?: number;
  }
) { }
```

### 6. Error Handling

```typescript
// Try/catch for all async operations
async function fetchUser(id: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    logger.error('Failed to fetch user', { id, error });
    throw error;
  }
}

// Specific error types
class ValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Throw specific errors
if (!email.includes('@')) {
  throw new ValidationError('Invalid email', 'email');
}
```

Rules:
- ✅ Try/catch on all async operations
- ✅ Specific error types (ValidationError, NotFoundError, etc)
- ✅ Log errors (don't silently ignore)
- ✅ Re-throw or handle appropriately
- ❌ Bare catch blocks
- ❌ Swallow errors without logging

### 7. No Debug Code

```typescript
// Bad ❌
console.log('user created:', user);
console.log('DEBUG: about to fetch');
debugger;
// const oldWay = users.map(u => u.email);

// Good ✅
logger.info('User created', { userId: user.id });
const newWay = users.map(u => u.contact.email);
```

Rules:
- ❌ No console.log (use logger)
- ❌ No debugger statements
- ❌ No commented-out code (use git history)
- ✅ Use proper logging (warn, error, info)

### 8. Imports Organization

```typescript
// 1. External packages
import express, { Request, Response } from 'express';
import { z } from 'zod';

// 2. Internal absolute imports (blank line)
import { UserService } from '@services/user.service';
import { validateEmail } from '@utils/validators';

// 3. Relative imports
import { logger } from '../logger';
```

---

## Project Setup

### 1. Package.json Scripts

```json
{
  "scripts": {
    "lint": "eslint src --ext .ts",
    "format": "prettier --write src",
    "format:check": "prettier --check src",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "build": "tsc",
    "dev": "ts-node src/index.ts"
  }
}
```

### 2. Install Dependencies

```bash
npm install -D typescript @types/node
npm install -D jest @types/jest ts-jest
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -D prettier
npm install -D husky lint-staged
```

### 3. Config Files

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

**.eslintrc.json:**
```json
{
  "parser": "@typescript-eslint/parser",
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "no-console": ["error", { "allow": ["warn", "error"] }],
    "no-var": "error",
    "prefer-const": "error",
    "eqeqeq": "error"
  }
}
```

**.prettierrc:**
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

**jest.config.js:**
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageThreshold: {
    global: { lines: 80, functions: 80, branches: 75 }
  }
};
```

---

## Before Handoff Checklist

- [ ] All functions have complete JSDoc
- [ ] `npm run type-check` passes (0 errors)
- [ ] `npm run lint` passes
- [ ] `npm run format` has been run
- [ ] `npm test` passes with >80% coverage
- [ ] `npm run build` succeeds
- [ ] No `console.log` or `debugger` statements
- [ ] No commented-out code
- [ ] All async operations wrapped in try/catch
- [ ] No secrets (API keys, passwords) in code
- [ ] README updated
- [ ] Tests cover happy path + edge cases

---

## Prompt Template

When asking Claude Code to generate code with this skill:

```
Generate production-ready [Node.js/React/etc] code for [feature].

Requirements:
1. Complete JSDoc for all public functions
2. Strict TypeScript (strict: true, no any)
3. Jest tests with >80% coverage
4. Error handling: try/catch for all async
5. No console.log, debugger, or commented code
6. Clear variable names
7. Max 20 lines per function
8. Validation for all inputs

The code must pass:
- npm run lint
- npm run format
- npm run type-check
- npm test -- --coverage
- npm run build
```

---

## Examples

### Good: Clean Function

```typescript
/**
 * Validates email format and checks if it exists
 * @param email - Email to validate
 * @returns true if valid and available
 * @throws ValidationError if format invalid
 */
async function validateEmail(email: string): Promise<boolean> {
  if (!email?.includes('@')) {
    throw new ValidationError('Invalid email format', 'email');
  }

  const existing = await db.users.findOne({ email });
  return !existing;
}

describe('validateEmail', () => {
  it('should return true for valid unclaimed email', async () => {
    const result = await validateEmail('new@example.com');
    expect(result).toBe(true);
  });

  it('should return false for existing email', async () => {
    const result = await validateEmail('taken@example.com');
    expect(result).toBe(false);
  });

  it('should throw for invalid format', async () => {
    await expect(validateEmail('not-an-email'))
      .rejects.toThrow(ValidationError);
  });
});
```

### Bad: Not Production-Ready

```javascript
// No docs, no types
function check(e) {
  // just check if it has @
  return e.includes('@');
}

// No tests
console.log('checking email');
```

---

## Further Reference

- TypeScript Strict: https://www.typescriptlang.org/tsconfig#strict
- Jest: https://jestjs.io
- JSDoc: https://jsdoc.app
- ESLint: https://eslint.org
- Prettier: https://prettier.io
