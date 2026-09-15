# Contributing to AI Prompt Registry

Thank you for your interest in contributing to AI Prompt Registry!

## Development Setup

1. Prerequisites:
   * Node.js 20+
   * pnpm 10+
   * Git

2. Setup instructions:
   ```bash
   git clone https://github.com/ai-prompt-registry/ai-prompt-registry.git
   cd ai-prompt-registry
   pnpm install
   ```

3. Testing and Verification:
   ```bash
   # Run all unit and integration tests
   pnpm test

   # Run typechecks across monorepo
   pnpm -r typecheck

   # Build all packages and applications
   pnpm -r build
   ```

4. Submitting Pull Requests:
   * Ensure all tests pass (`pnpm test`).
   * Write unit tests for new features or bug fixes.
   * Follow existing TypeScript strict conventions.
   * Keep PRs focused and well-documented.
