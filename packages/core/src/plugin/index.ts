export { definePlugin } from './define-plugin.ts';
export type { PluginInstallResult } from './install.ts';
export {
  cloneRepository,
  derivePluginFolderName,
  installPlugin,
  removeFolder,
  validateInstalledPlugin,
} from './install.ts';
export type {
  ConfigField,
  MatchPattern,
  PluginManifest,
  PluginResolveResult,
  ResolveContext,
} from './types.ts';
