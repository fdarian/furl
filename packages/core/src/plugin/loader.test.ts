import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Effect } from 'effect';

import { definePlugin } from './define-plugin.ts';
import { PluginLoader } from './loader.ts';

describe('PluginLoader virtual furl-cli/plugins module', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'furl-loader-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves the real authoring module to plugins', async () => {
    const entrypoint = path.join(tempDir, 'index.ts');
    fs.writeFileSync(
      entrypoint,
      `import * as authoring from 'furl-cli/plugins';
import definePluginDefault, { definePlugin } from 'furl-cli/plugins';
export default { authoring, same: definePlugin === definePluginDefault };`,
    );

    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const loader = yield* PluginLoader;
        return yield* loader.load(entrypoint);
      }).pipe(Effect.provide(PluginLoader.layer)),
    );

    expect(loaded.same).toBe(true);
    expect(loaded.authoring.definePlugin).toBe(definePlugin);
  });
});
