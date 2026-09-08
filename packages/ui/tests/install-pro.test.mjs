import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('a clean install fails clearly when the custom distribution key is missing', () => {
  const env = { ...process.env };
  delete env.HEROUI_KEY;
  const result = spawnSync(process.execPath, [new URL('../scripts/install-pro.mjs', import.meta.url).pathname], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HEROUI_KEY is required/);
});

test('dev/build reuse complete artifacts and require setup for an incomplete install', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omni-pro-install-'));
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@heroui-pro/react': '1.0.0-beta.6' } }));
    const target = join(cwd, 'node_modules/@heroui-pro/react');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), JSON.stringify({ version: '1.0.0-beta.6' }));
    const files = ['index.js', 'css/index.css', 'components/sidebar/index.js', 'components/stepper/index.js', 'components/empty-state/index.js'];
    for (const file of files) {
      const path = join(target, 'dist', file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'fixture');
    }
    const env = { ...process.env };
    delete env.HEROUI_KEY;
    const run = () => spawnSync(process.execPath, [new URL('../scripts/install-pro.mjs', import.meta.url).pathname, '--if-missing'], { cwd, env, encoding: 'utf8' });
    assert.equal(run().status, 0);
    rmSync(join(target, 'dist/components/sidebar/index.js'));
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /HEROUI_KEY is required/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
