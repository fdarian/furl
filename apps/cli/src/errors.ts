import { Schema } from 'effect';
import { describeCause, redactUrlUserInfo } from 'furl-lib';

export class KeychainError extends Schema.TaggedError<KeychainError>(
  'furl/KeychainError',
)('KeychainError', {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Keychain access failed: ${describeCause(this.cause)}`;
  }
}

export class MissingProviderKeyError extends Schema.TaggedError<MissingProviderKeyError>(
  'furl/MissingProviderKeyError',
)('MissingProviderKeyError', {
  provider: Schema.String,
}) {
  override get message(): string {
    return `No API key configured for ${this.provider}. Run \`furl providers\`.`;
  }
}

export class InvalidSecretError extends Schema.TaggedError<InvalidSecretError>(
  'furl/InvalidSecretError',
)('InvalidSecretError', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export class PluginLoadError extends Schema.TaggedError<PluginLoadError>(
  'furl/PluginLoadError',
)('PluginLoadError', {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `${this.path}: ${describeCause(this.cause)}`;
  }
}

export class PluginInstallError extends Schema.TaggedError<PluginInstallError>(
  'furl/PluginInstallError',
)('PluginInstallError', {
  url: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to install plugin from ${redactUrlUserInfo(this.url)}: ${redactUrlUserInfo(describeCause(this.cause))}`;
  }
}

export class PluginNotFoundError extends Schema.TaggedError<PluginNotFoundError>(
  'furl/PluginNotFoundError',
)('PluginNotFoundError', {
  name: Schema.String,
}) {
  override get message(): string {
    return `No installed plugin named "${this.name}".`;
  }
}

export class PluginUninstallError extends Schema.TaggedError<PluginUninstallError>(
  'furl/PluginUninstallError',
)('PluginUninstallError', {
  name: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to uninstall plugin "${this.name}": ${describeCause(this.cause)}`;
  }
}
