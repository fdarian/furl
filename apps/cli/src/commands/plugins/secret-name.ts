/** Names a plugin field's keychain entry so two plugins with the same field key never collide. */
export const secretNameFor = (pluginId: string, fieldKey: string): string =>
  `${pluginId}.${fieldKey}`;
