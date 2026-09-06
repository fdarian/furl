import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { derivePluginFolderName } from './install.ts';

/**
 * Exercises `derivePluginFolderName` — the only place a plugin install URL
 * is parsed before anything is spawned. Covers the scheme allowlist that
 * closes the `git clone ext::...` RCE (see `install.ts`) and the folder-name
 * derivation rules, offline and without touching the filesystem.
 */

describe('derivePluginFolderName', () => {
  it('accepts an https URL', async () => {
    const folderName = await Effect.runPromise(
      derivePluginFolderName('https://github.com/foo/bar'),
    );

    expect(folderName).toBe('github-foo-bar');
  });

  it('accepts an ssh URL', async () => {
    const folderName = await Effect.runPromise(
      derivePluginFolderName('ssh://git@github.com/foo/bar.git'),
    );

    expect(folderName).toBe('github-foo-bar');
  });

  it('accepts a git URL', async () => {
    const folderName = await Effect.runPromise(
      derivePluginFolderName('git://github.com/foo/bar.git'),
    );

    expect(folderName).toBe('github-foo-bar');
  });

  it("rejects an ext: URL (git's arbitrary-command transport)", async () => {
    const error = await Effect.runPromise(
      Effect.flip(derivePluginFolderName('ext::sh -c "touch /tmp/pwned"')),
    );

    expect(error._tag).toBe('PluginInstallError');
    expect(String(error.cause)).toContain('Unsupported URL scheme');
  });

  it('rejects a file: URL', async () => {
    const error = await Effect.runPromise(
      Effect.flip(derivePluginFolderName('file:///etc/passwd')),
    );

    expect(error._tag).toBe('PluginInstallError');
    expect(String(error.cause)).toContain('Unsupported URL scheme');
  });

  it('rejects an ftp: URL', async () => {
    const error = await Effect.runPromise(
      Effect.flip(derivePluginFolderName('ftp://example.com/foo/bar')),
    );

    expect(error._tag).toBe('PluginInstallError');
    expect(String(error.cause)).toContain('Unsupported URL scheme');
  });

  it('rejects any other unrecognized scheme', async () => {
    const error = await Effect.runPromise(
      Effect.flip(derivePluginFolderName('javascript:alert(1)')),
    );

    expect(error._tag).toBe('PluginInstallError');
    expect(String(error.cause)).toContain('Unsupported URL scheme');
  });

  it('falls back to the full hostname for a single-label host', async () => {
    const folderName = await Effect.runPromise(
      derivePluginFolderName('https://localhost/foo/bar'),
    );

    expect(folderName).toBe('localhost-foo-bar');
  });

  it('strips a trailing .git suffix from path segments', async () => {
    const folderName = await Effect.runPromise(
      derivePluginFolderName('https://gitlab.com/group/sub/project.git'),
    );

    expect(folderName).toBe('gitlab-group-sub-project');
  });

  it('fails when the URL has no repository path', async () => {
    const error = await Effect.runPromise(
      Effect.flip(derivePluginFolderName('https://github.com')),
    );

    expect(error._tag).toBe('PluginInstallError');
    expect(String(error.cause)).toContain('no repository path');
  });

  it('fails when the URL cannot be parsed at all', async () => {
    const error = await Effect.runPromise(
      Effect.flip(derivePluginFolderName('not a url')),
    );

    expect(error._tag).toBe('PluginInstallError');
  });
});
