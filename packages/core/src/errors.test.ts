import { describe, expect, it } from 'bun:test';

import {
  AllResolversFailed,
  describeCause,
  FetchError,
  KeychainError,
  PluginLoadError,
  ProviderError,
  redactUrlUserInfo,
} from './errors.ts';

describe('error messages', () => {
  it('describes a FetchError with the redacted URL, status and cause', () => {
    const error = new FetchError({
      url: 'https://user:pass@example.com/page',
      status: 503,
      cause: new Error('Unexpected status 503'),
    });

    expect(error.message).toBe(
      'Failed to fetch https://[redacted]@example.com/page (status 503): Unexpected status 503',
    );
  });

  it('omits the status from a FetchError without one', () => {
    const error = new FetchError({
      url: 'https://example.com/page',
      status: undefined,
      cause: new Error('network down'),
    });

    expect(error.message).toBe(
      'Failed to fetch https://example.com/page: network down',
    );
  });

  it('redacts credentials echoed inside a FetchError cause', () => {
    const error = new FetchError({
      url: 'not a url',
      status: undefined,
      cause: new Error('bad https://user:pass@example.com/x'),
    });

    expect(error.message).not.toContain('pass');
  });

  it('describes a ProviderError', () => {
    const error = new ProviderError({
      provider: 'jina',
      cause: new Error('Unexpected status 429'),
    });

    expect(error.message).toBe('jina request failed: Unexpected status 429');
  });

  it('describes a KeychainError', () => {
    const error = new KeychainError({ cause: new Error('locked') });

    expect(error.message).toBe('Keychain access failed: locked');
  });

  it('describes a PluginLoadError as "path: cause"', () => {
    const error = new PluginLoadError({
      path: '/plugins/x',
      cause: new Error('no entrypoint'),
    });

    expect(error.message).toBe('/plugins/x: no entrypoint');
  });

  it('shows a nested tagged error in AllResolversFailed', () => {
    const error = new AllResolversFailed({
      url: 'https://example.com',
      failures: [
        {
          id: 'default:jina',
          cause: new ProviderError({
            provider: 'jina',
            cause: new Error('boom'),
          }),
        },
      ],
    });

    expect(error.message).toContain('default:jina (jina request failed: boom)');
  });
});

describe('describeCause', () => {
  it('returns an Error message and a string as-is', () => {
    expect(describeCause(new Error('x'))).toBe('x');
    expect(describeCause('plain')).toBe('plain');
  });

  it('falls back to the _tag when the message is empty', () => {
    const error = Object.assign(new Error(''), { _tag: 'Tagged' });

    expect(describeCause(error)).toBe('Tagged');
  });

  it('recurses into .cause when the message is empty', () => {
    const error = new Error('', { cause: new Error('inner') });

    expect(describeCause(error)).toBe('inner');
  });

  it('combines the _tag with the nested cause', () => {
    const error = Object.assign(new Error('', { cause: new Error('inner') }), {
      _tag: 'Tagged',
    });

    expect(describeCause(error)).toBe('Tagged: inner');
  });

  it('falls back to the error name when nothing else is available', () => {
    expect(describeCause(new TypeError(''))).toBe('TypeError');
  });

  it('does not loop on a self-referencing cause', () => {
    const error = new Error('');
    error.cause = error;

    expect(describeCause(error)).toBe('Error');
  });

  it('serializes plain values and survives BigInt and circular values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(describeCause({ a: 1 })).toBe('{"a":1}');
    expect(describeCause(10n)).toBe('10');
    expect(describeCause(circular)).toBe('[object Object]');
    expect(describeCause(undefined)).toBe('undefined');
  });
});

describe('redactUrlUserInfo', () => {
  it('replaces userinfo in credentialed URLs and leaves clean URLs alone', () => {
    expect(redactUrlUserInfo('https://user:pass@example.com/p')).toBe(
      'https://[redacted]@example.com/p',
    );
    expect(redactUrlUserInfo('https://example.com/p')).toBe(
      'https://example.com/p',
    );
  });
});
