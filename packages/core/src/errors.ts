import { Schema } from 'effect';

export class FetchError extends Schema.TaggedErrorClass<FetchError>(
  'furl/FetchError',
)('FetchError', {
  url: Schema.String,
  status: Schema.optional(Schema.Number),
  cause: Schema.Defect(),
}) {}

export class ProviderError extends Schema.TaggedErrorClass<ProviderError>(
  'furl/ProviderError',
)('ProviderError', {
  provider: Schema.String,
  cause: Schema.Defect(),
}) {}

export class NoProviderKey extends Schema.TaggedErrorClass<NoProviderKey>(
  'furl/NoProviderKey',
)('NoProviderKey', {
  provider: Schema.String,
}) {
  override get message(): string {
    return `No API key configured for ${this.provider}. Run \`furl providers\`.`;
  }
}

export class KeychainError extends Schema.TaggedErrorClass<KeychainError>(
  'furl/KeychainError',
)('KeychainError', {
  cause: Schema.Defect(),
}) {}

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>(
  'furl/ConfigError',
)('ConfigError', {
  cause: Schema.Defect(),
}) {}

export class ResolverError extends Schema.TaggedErrorClass<ResolverError>(
  'furl/ResolverError',
)('ResolverError', {
  id: Schema.String,
  cause: Schema.Defect(),
}) {}

export class AllResolversFailed extends Schema.TaggedErrorClass<AllResolversFailed>(
  'furl/AllResolversFailed',
)('AllResolversFailed', {
  url: Schema.String,
}) {
  override get message(): string {
    return `No resolver could produce markdown for ${this.url}.`;
  }
}
