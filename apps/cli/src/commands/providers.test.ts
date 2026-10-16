import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { FurlConfig } from '@furl/core';
import { FurlConfigService } from '@furl/core';
import { Effect, Option } from 'effect';

import {
  hintIfJinaNotInOrder,
  migrateLegacyProvider,
  removeProviderFromOrder,
} from './providers';

const makeConfigService = (initial: FurlConfig) => {
  const writes: FurlConfig[] = [];
  const service = {
    read: Effect.succeed(initial),
    resolveProvider: Effect.succeed(Option.none()),
    resolveOrder: Effect.succeed(initial.order ?? ['default:*']),
    write: (config: FurlConfig) =>
      Effect.sync(() => {
        writes.push(config);
      }),
  };
  return { service: service, writes: writes };
};

const run = <A, E>(
  effect: Effect.Effect<A, E, FurlConfigService>,
  initial: FurlConfig,
) => {
  const stub = makeConfigService(initial);
  return Effect.runPromise(
    Effect.provideService(effect, FurlConfigService, stub.service),
  ).then(() => stub.writes);
};

describe('providers command helpers', () => {
  let logs: string[];
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logs = [];
    logSpy = spyOn(console, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('migrateLegacyProvider', () => {
    it('writes the config and says it migrated when provider is present', async () => {
      const config: FurlConfig = {
        provider: 'exa',
        order: ['default:*', 'default:exa'],
        extra: true,
      };

      const writes = await run(migrateLegacyProvider(config), config);

      expect(writes).toEqual([config]);
      expect(logs.join('\n')).toContain('Migrated');
    });

    it('does nothing when there is no legacy provider', async () => {
      const config: FurlConfig = { order: ['default:*'] };

      const writes = await run(migrateLegacyProvider(config), config);

      expect(writes).toEqual([]);
      expect(logs).toEqual([]);
    });
  });

  describe('removeProviderFromOrder', () => {
    it('removes the provider token, keeps other fields, and never adds jina', async () => {
      const config: FurlConfig = {
        order: ['default:*', 'default:exa'],
        plugins: { alpha: { mode: 'full' } },
        extra: 1,
      };

      const writes = await run(removeProviderFromOrder('exa'), config);

      expect(writes).toEqual([{ ...config, order: ['default:*'] }]);
      expect(logs.join('\n')).toContain('Removed exa');
    });

    it('deletes the order key when removal leaves it empty', async () => {
      const config: FurlConfig = {
        order: ['default:exa'],
        plugins: { alpha: { mode: 'full' } },
      };

      const writes = await run(removeProviderFromOrder('exa'), config);

      expect(writes).toEqual([{ plugins: { alpha: { mode: 'full' } } }]);
      expect(Object.keys(writes[0] ?? {})).not.toContain('order');
      expect(logs.join('\n')).toContain('default:*');
    });

    it('does not write when the provider is not in the order', async () => {
      const writes = await run(removeProviderFromOrder('exa'), {
        order: ['default:*'],
      });

      expect(writes).toEqual([]);
      expect(logs).toEqual([]);
    });
  });

  describe('hintIfJinaNotInOrder', () => {
    it('prints a hint when default:jina is missing from the order', async () => {
      await run(hintIfJinaNotInOrder(), { order: ['default:*'] });

      expect(logs.join('\n')).toContain('default:jina');
    });

    it('prints nothing when default:jina is in the order', async () => {
      await run(hintIfJinaNotInOrder(), {
        order: ['default:*', 'default:jina'],
      });

      expect(logs).toEqual([]);
    });
  });
});
