import { describe, expect, it } from 'bun:test';

import { secretNameFor } from './secret-name';

describe('secretNameFor', () => {
  it('scopes the field key under the plugin id', () => {
    expect(secretNameFor('exa-search', 'apiKey')).toBe('exa-search.apiKey');
  });

  it('keeps same-named fields of different plugins apart', () => {
    expect(secretNameFor('a', 'token')).not.toBe(secretNameFor('b', 'token'));
  });
});
