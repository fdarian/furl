# @repo/config

- Purpose: Shared TypeScript presets for the monorepo.
- Stack: TypeScript config presets via `@total-typescript/tsconfig`.
- Files:
  - `tsconfig-library.json`
  - `tsconfig-server.json`
- Usage:
  - Libraries extend `@repo/config/tsconfig-library`
  - Apps extend `@repo/config/tsconfig-server`
