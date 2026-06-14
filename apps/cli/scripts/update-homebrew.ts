import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = process.env.VERSION;
if (!VERSION) {
  throw new Error('VERSION environment variable is required');
}

const HOMEBREW_TAP_TOKEN = process.env.HOMEBREW_TAP_TOKEN;
if (!HOMEBREW_TAP_TOKEN) {
  throw new Error('HOMEBREW_TAP_TOKEN environment variable is required');
}

const labels = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];

/** Compute sha256 hex of a file */
function sha256File(path: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(readFileSync(path));
  return hasher.digest('hex');
}

const shas = Object.fromEntries(
  labels.map((label) => [
    label,
    sha256File(`dist/releases/furl-${label}.tar.gz`),
  ]),
);

const encodedVersion = VERSION.replace(/@/g, '%40');
const releaseTag = `furl-cli%40${encodedVersion}`;
const baseUrl = `https://github.com/fdarian/furl/releases/download/${releaseTag}`;

function assetUrl(label: string): string {
  return `${baseUrl}/furl-${label}.tar.gz`;
}

const formula = `class Furl < Formula
  desc "Fetch a URL and return LLM-optimized markdown"
  homepage "https://github.com/fdarian/furl"
  version "${VERSION}"

  on_macos do
    if Hardware::CPU.arm?
      url "${assetUrl('darwin-arm64')}"
      sha256 "${shas['darwin-arm64']}"
    else
      url "${assetUrl('darwin-x64')}"
      sha256 "${shas['darwin-x64']}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${assetUrl('linux-arm64')}"
      sha256 "${shas['linux-arm64']}"
    else
      url "${assetUrl('linux-x64')}"
      sha256 "${shas['linux-x64']}"
    end
  end

  def install
    bin.install "furl"
  end
end
`;

const tmpDir = join(tmpdir(), `homebrew-tap-${Date.now()}`);

try {
  const cloneResult = Bun.spawnSync([
    'git',
    'clone',
    `https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/fdarian/homebrew-tap`,
    tmpDir,
  ]);

  if (cloneResult.exitCode !== 0) {
    throw new Error(`git clone failed with exit code ${cloneResult.exitCode}`);
  }

  const formulaDir = join(tmpDir, 'Formula');
  mkdirSync(formulaDir, { recursive: true });
  writeFileSync(join(formulaDir, 'furl.rb'), formula);

  function runGit(args: string[]): void {
    const result = Bun.spawnSync(['git', ...args], { cwd: tmpDir });
    if (result.exitCode !== 0) {
      throw new Error(
        `git ${args[0]} failed with exit code ${result.exitCode}`,
      );
    }
  }

  runGit([
    'config',
    'user.email',
    'github-actions[bot]@users.noreply.github.com',
  ]);
  runGit(['config', 'user.name', 'github-actions[bot]']);
  runGit(['add', 'Formula/furl.rb']);
  runGit(['commit', '-m', `furl ${VERSION}`]);
  runGit(['push']);

  console.log(`Updated homebrew-tap formula to furl ${VERSION}`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
