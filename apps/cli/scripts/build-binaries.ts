import { mkdirSync } from 'node:fs';

const targets = [
  { bun: 'bun-darwin-arm64', label: 'darwin-arm64' },
  { bun: 'bun-darwin-x64', label: 'darwin-x64' },
  { bun: 'bun-linux-x64', label: 'linux-x64' },
  { bun: 'bun-linux-arm64', label: 'linux-arm64' },
];

for (const target of targets) {
  const outDir = `dist/bin/${target.label}`;
  const releaseDir = 'dist/releases';

  mkdirSync(outDir, { recursive: true });
  mkdirSync(releaseDir, { recursive: true });

  const buildResult = Bun.spawnSync([
    'bun',
    'build',
    '--compile',
    `--target=${target.bun}`,
    'src/main.ts',
    '--outfile',
    `${outDir}/furl`,
  ]);

  if (buildResult.exitCode !== 0) {
    throw new Error(
      `bun build failed for target '${target.label}' with exit code ${buildResult.exitCode}`,
    );
  }

  const tarResult = Bun.spawnSync([
    'tar',
    '-czf',
    `${releaseDir}/furl-${target.label}.tar.gz`,
    '-C',
    `dist/bin/${target.label}`,
    'furl',
  ]);

  if (tarResult.exitCode !== 0) {
    throw new Error(
      `tar failed for target '${target.label}' with exit code ${tarResult.exitCode}`,
    );
  }

  console.log(`Built and packaged furl-${target.label}.tar.gz`);
}
