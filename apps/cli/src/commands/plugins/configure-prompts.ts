import type { ConfigField } from '@furl/core';
import { Effect, Option } from 'effect';
import type { Prompt } from 'effect/unstable/cli';

// effect's prompts crash on an explicit `default: undefined` / `validate: undefined`,
// so these builders add those keys only when they have a value.

const requiredString = (input: string): Effect.Effect<string, string> =>
  input.trim().length === 0
    ? Effect.fail('This field is required.')
    : Effect.succeed(input);

const numberOrEmpty = (input: string): Effect.Effect<string, string> =>
  input.trim().length === 0 || Number.isFinite(Number(input))
    ? Effect.succeed(input)
    : Effect.fail('Enter a number.');

export const fieldMessage = (
  field: ConfigField,
  savedSecret: boolean,
): string => {
  const label = field.label ?? field.key;
  const description = field.description ? ` - ${field.description}` : '';

  if (savedSecret) {
    return `${label}${description} (press enter to keep the saved value)`;
  }

  return field.required
    ? `${label}${description}`
    : `${label}${description} (optional, press enter to skip)`;
};

export const stringPromptOptions = (
  message: string,
  field: ConfigField,
  existingValue: unknown,
): Prompt.TextOptions => ({
  message: message,
  ...(typeof existingValue === 'string' ? { default: existingValue } : {}),
  ...(field.required ? { validate: requiredString } : {}),
});

/** A required secret with nothing stored must be entered: the prompt re-asks until it is non-empty. */
export const passwordPromptOptions = (
  message: string,
  mustEnter: boolean,
): Prompt.TextOptions => ({
  message: message,
  ...(mustEnter ? { validate: requiredString } : {}),
});

export const intPromptOptions = (
  message: string,
  existingValue: unknown,
): Prompt.IntOptions => ({
  message: message,
  ...(typeof existingValue === 'number' ? { default: existingValue } : {}),
});

export const optionalNumberPromptOptions = (
  message: string,
  existingValue: unknown,
): Prompt.TextOptions => ({
  message: message,
  validate: numberOrEmpty,
  ...(typeof existingValue === 'number'
    ? { default: String(existingValue) }
    : {}),
});

export const parseOptionalNumber = (input: string): Option.Option<number> =>
  input.trim().length === 0 ? Option.none() : Option.some(Number(input));

export const optionalBooleanChoices = [
  { title: '(skip)', value: null as boolean | null },
  { title: 'true', value: true as boolean | null },
  { title: 'false', value: false as boolean | null },
];

/** Select starts on the first choice, so the saved option goes first. */
export const enumChoices = (
  field: ConfigField,
  existingValue: unknown,
): Array<{ title: string; value: string | null }> => {
  const options = field.options;
  if (options === undefined) {
    throw new Error(`Enum field "${field.key}" has no options`);
  }

  const saved = options.find((option) => option === existingValue);
  const ordered =
    saved === undefined
      ? options
      : [saved, ...options.filter((option) => option !== saved)];
  const choices = ordered.map((option) => ({
    title: option === saved ? `${option} (current)` : option,
    value: option as string | null,
  }));

  return field.required
    ? choices
    : [...choices, { title: '(skip)', value: null }];
};
