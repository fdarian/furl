import { describe, expect, it } from 'bun:test';
import type { ConfigField } from '@furl/core';
import { Effect, Option } from 'effect';

import {
  enumChoices,
  fieldMessage,
  intPromptOptions,
  optionalBooleanChoices,
  optionalNumberPromptOptions,
  parseOptionalNumber,
  passwordPromptOptions,
  stringPromptOptions,
} from './configure-prompts';

const field = (overrides: Partial<ConfigField> = {}): ConfigField => ({
  key: 'k',
  type: 'string',
  ...overrides,
});

describe('stringPromptOptions', () => {
  it('omits default and validate when there is nothing to put in them', () => {
    const options = stringPromptOptions('m', field(), undefined);

    expect(Object.keys(options)).toEqual(['message']);
  });

  it('includes default only for a saved string', () => {
    expect(stringPromptOptions('m', field(), 'saved').default).toBe('saved');
    expect('default' in stringPromptOptions('m', field(), 42)).toBe(false);
  });

  it('includes validate only for required fields, rejecting blanks', async () => {
    const optional = stringPromptOptions('m', field(), undefined);
    const required = stringPromptOptions(
      'm',
      field({ required: true }),
      undefined,
    );

    expect('validate' in optional).toBe(false);
    const validate = required.validate;
    if (validate === undefined) {
      throw new Error('expected a validate function');
    }
    expect(await Effect.runPromise(Effect.flip(validate('  ')))).toBe(
      'This field is required.',
    );
    expect(await Effect.runPromise(validate('ok'))).toBe('ok');
  });
});

describe('passwordPromptOptions', () => {
  it('has no validate key unless the secret must be entered', () => {
    expect(Object.keys(passwordPromptOptions('m', false))).toEqual(['message']);
    expect('validate' in passwordPromptOptions('m', true)).toBe(true);
  });

  it('re-prompts an empty entry when it must be entered', async () => {
    const validate = passwordPromptOptions('m', true).validate;
    if (validate === undefined) {
      throw new Error('expected a validate function');
    }

    expect(await Effect.runPromise(Effect.flip(validate('')))).toBe(
      'This field is required.',
    );
    expect(await Effect.runPromise(validate('s3cret'))).toBe('s3cret');
  });
});

describe('intPromptOptions', () => {
  it('omits default without a saved number', () => {
    expect(Object.keys(intPromptOptions('m', undefined))).toEqual(['message']);
    expect(Object.keys(intPromptOptions('m', '3'))).toEqual(['message']);
  });

  it('includes default for a saved number', () => {
    expect(intPromptOptions('m', 3).default).toBe(3);
  });
});

describe('optional numbers', () => {
  it('omits default without a saved number and always validates', () => {
    const options = optionalNumberPromptOptions('m', undefined);

    expect('default' in options).toBe(false);
    expect(typeof options.validate).toBe('function');
  });

  it('shows a saved number as text', () => {
    expect(optionalNumberPromptOptions('m', 2.5).default).toBe('2.5');
  });

  it('accepts blank and numeric input, rejects the rest', async () => {
    const validate = optionalNumberPromptOptions('m', undefined).validate;
    if (validate === undefined) {
      throw new Error('expected a validate function');
    }

    expect(await Effect.runPromise(validate(''))).toBe('');
    expect(await Effect.runPromise(validate('1.5'))).toBe('1.5');
    expect(await Effect.runPromise(Effect.flip(validate('abc')))).toBe(
      'Enter a number.',
    );
    expect(await Effect.runPromise(Effect.flip(validate('Infinity')))).toBe(
      'Enter a number.',
    );
  });

  it('parses blank as skip, otherwise the number', () => {
    expect(Option.isNone(parseOptionalNumber('  '))).toBe(true);
    expect(parseOptionalNumber('0')).toEqual(Option.some(0));
    expect(parseOptionalNumber('-2.5')).toEqual(Option.some(-2.5));
  });
});

describe('optionalBooleanChoices', () => {
  it('offers skip, true and false in that order', () => {
    expect(optionalBooleanChoices.map((choice) => choice.value)).toEqual([
      null,
      true,
      false,
    ]);
  });
});

describe('enumChoices', () => {
  const enumField = field({ type: 'enum', options: ['a', 'b', 'c'] });

  it('keeps option order and appends skip for optional fields', () => {
    expect(enumChoices(enumField, undefined).map((c) => c.value)).toEqual([
      'a',
      'b',
      'c',
      null,
    ]);
  });

  it('puts the saved option first so it is preselected', () => {
    const choices = enumChoices(enumField, 'b');

    expect(choices.map((c) => c.value)).toEqual(['b', 'a', 'c', null]);
    expect(choices[0]?.title).toBe('b (current)');
  });

  it('has no skip for required fields and ignores an unknown saved value', () => {
    const choices = enumChoices({ ...enumField, required: true }, 'zzz');

    expect(choices.map((c) => c.value)).toEqual(['a', 'b', 'c']);
  });
});

describe('fieldMessage', () => {
  it('hints skip for optional fields, keep for saved secrets', () => {
    expect(fieldMessage(field(), false)).toBe(
      'k (optional, press enter to skip)',
    );
    expect(fieldMessage(field({ required: true, label: 'Key' }), false)).toBe(
      'Key',
    );
    expect(fieldMessage(field({ required: true }), true)).toContain(
      'keep the saved value',
    );
  });
});
