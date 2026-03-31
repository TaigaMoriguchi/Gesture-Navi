import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const distDir = path.join(rootDir, 'dist');
const releaseDir = path.join(rootDir, 'release');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? 'unknown'}`);
  }
}

async function main() {
  const packageJsonRaw = await readFile(path.join(rootDir, 'package.json'), 'utf8');
  const packageJson = JSON.parse(packageJsonRaw);
  const zipName = `gesture-ops-mvp-v${packageJson.version}.zip`;
  const zipPath = path.join(releaseDir, zipName);

  run('node', ['scripts/build.mjs'], { cwd: rootDir });

  await mkdir(releaseDir, { recursive: true });
  await rm(zipPath, { force: true });

  run(
    'zip',
    ['-r', zipPath, '.', '-x', '*.map', '*/.DS_Store', '__MACOSX/*'],
    { cwd: distDir }
  );

  console.log(`Created: ${zipPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
