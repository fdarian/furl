import { Schema } from 'effect';

export class FetchError extends Schema.TaggedError<FetchError>(
  'furl/FetchError',
)('FetchError', {
  url: Schema.String,
  status: Schema.optional(Schema.Number),
  cause: Schema.Defect(),
}) {}

export class ProviderError extends Schema.TaggedError<ProviderError>(
  'furl/ProviderError',
)('ProviderError', {
  provider: Schema.String,
  cause: Schema.Defect(),
}) {}

export class NoProviderKey extends Schema.TaggedError<NoProviderKey>(
  'furl/NoProviderKey',
)('NoProviderKey', {
  provider: Schema.String,
}) {
  override get message(): string {
    return `No API key configured for ${this.provider}. Run \`furl providers\`.`;
  }
}

export class KeychainError extends Schema.TaggedError<KeychainError>(
  'furl/KeychainError',
)('KeychainError', {
  cause: Schema.Defect(),
}) {}

export class ConfigError extends Schema.TaggedError<ConfigError>(
  'furl/ConfigError',
)('ConfigError', {
  cause: Schema.Defect(),
}) {}

export class ResolverError extends Schema.TaggedError<ResolverError>(
  'furl/ResolverError',
)('ResolverError', {
  id: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Resolver "${this.id}" failed: ${describeCause(this.cause)}`;
  }
}

export class AllResolversFailed extends Schema.TaggedError<AllResolversFailed>(
  'furl/AllResolversFailed',
)('AllResolversFailed', {
  url: Schema.String,
  failures: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      cause: Schema.Defect(),
    }),
  ),
}) {
  override get message(): string {
    if (this.failures.length === 0) {
      return `No resolver could produce markdown for ${this.url}.`;
    }

    const summary = this.failures
      .map((failure) => `${failure.id} (${describeCause(failure.cause)})`)
      .join(', ');

    return `No resolver could produce markdown for ${this.url}. Tried: ${summary}.`;
  }
}

export class PluginLoadError extends Schema.TaggedError<PluginLoadError>(
  'furl/PluginLoadError',
)('PluginLoadError', {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === 'string') {
    return cause;
  }

  const serialized = JSON.stringify(cause);
  return serialized === undefined ? String(cause) : serialized;
};
