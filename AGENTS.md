# furl

- Purpose: pnpm + Turborepo monorepo for the `furl` CLI and shared fetch engine.
- Workspaces: `apps/cli`, `packages/core`, `packages/config`.
- Tooling: pnpm (package manager), Bun (runtime), Turborepo, Biome, TypeScript, Effect v4 beta.
- Root commands:
  - `pnpm install`
  - `pnpm run check`
  - `pnpm run format`
- Key files:
  - `package.json`
  - `turbo.jsonc`
  - `biome.jsonc`
  - `packages/config/*`
