import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { PRODUCTS } from 'hpsetup/src/constants.js';
import { downloadFromProxy } from 'hpsetup/src/download.js';
import { patchPackageJson } from 'hpsetup/src/patch.js';

let key = process.env.HEROUI_KEY;
try {
  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const manifest = readJson('package.json');
  const product = PRODUCTS.react;
  const version = manifest.dependencies?.[product.packageName] ?? manifest.devDependencies?.[product.packageName];
  const target = join(process.cwd(), 'node_modules', product.packageName);
  const files = ['index.js', 'css/index.css', 'components/sidebar/index.js', 'components/stepper/index.js', 'components/empty-state/index.js'];
  const hasArtifacts = () => existsSync(join(target, 'package.json')) &&
    readJson(join(target, 'package.json')).version === version && files.every((file) => {
      const path = join(target, 'dist', file);
      return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
    });
  if (process.argv.includes('--if-missing') && hasArtifacts()) process.exit(0);
  const root = resolve(manifest.name === '@omnistudio/ui' ? '../..' : '..');
  for (const file of [resolve('.env.local'), join(root, '.env.local'), resolve('.env'), join(root, '.env')]) {
    if (!key && existsSync(file)) key = parseEnv(readFileSync(file, 'utf8')).HEROUI_KEY;
  }
  assert(key, 'HEROUI_KEY is required in the environment or .env.local for the configured Pro distribution.');
  assert.equal(readJson(join(target, 'package.json')).version, version, 'Run npm ci with the pinned Pro version first.');

  // Use the existing distributor without the CLI's automatic dependency upgrades.
  await downloadFromProxy(product, version, target, key, false, Boolean(process.env.CI));
  assert.equal(readJson(join(target, 'package.json')).version, version, 'The Pro artifact version must match package.json.');
  patchPackageJson(target, 'react', product.packageName);
  assert(hasArtifacts(), 'The Pro artifact is incomplete. Run heroui:setup again.');
  console.log(`Verified ${product.packageName}@${version}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(key ? message.replaceAll(key, '[redacted]') : message);
  process.exitCode = 1;
}
