import { build } from 'esbuild';
import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const distDir = path.join(rootDir, 'dist');

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await build({
    entryPoints: {
      background: path.join(rootDir, 'src/background.ts'),
      content: path.join(rootDir, 'src/content.ts'),
      popup: path.join(rootDir, 'src/popup/popup.ts')
    },
    outdir: distDir,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    sourcemap: true,
    logLevel: 'info'
  });

  await copyFile(
    path.join(rootDir, 'src/manifest.json'),
    path.join(distDir, 'manifest.json')
  );
  await copyFile(
    path.join(rootDir, 'src/popup/popup.html'),
    path.join(distDir, 'popup.html')
  );

  await cp(
    path.join(rootDir, 'node_modules/@mediapipe/tasks-vision/wasm'),
    path.join(distDir, 'assets/wasm'),
    { recursive: true }
  );

  await cp(
    path.join(rootDir, 'assets/models'),
    path.join(distDir, 'assets/models'),
    { recursive: true }
  );

  await cp(
    path.join(rootDir, 'assets/icons'),
    path.join(distDir, 'assets/icons'),
    { recursive: true }
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
