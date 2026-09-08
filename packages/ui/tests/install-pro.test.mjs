import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('a clean install fails clearly when the custom distribution key is missing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'omni-pro-no-key-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@heroui-pro/react': '1.0.0-beta.6' } }));
  const env = { ...process.env };
  delete env.HEROUI_KEY;
  const result = spawnSync(process.execPath, [new URL('../scripts/install-pro.mjs', import.meta.url).pathname], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HEROUI_KEY is required/);
});

test('frontend and component installs read env files, preserve environment precedence, and redact the key', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-pro-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rootKey = 'fixture-root-key';
  writeFileSync(join(root, '.env.local'), `HEROUI_KEY="${rootKey}" # local build only\n`);
  for (const [directory, name] of [['frontend', 'frontend'], ['packages/ui', '@omnistudio/ui']]) {
    const cwd = join(root, directory);
    const target = join(cwd, 'node_modules/@heroui-pro/react');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name, dependencies: { '@heroui-pro/react': '1.0.0-beta.6' } }));
    writeFileSync(join(target, 'package.json'), JSON.stringify({ version: '1.0.0-beta.6' }));
    const run = (expectedKey, override) => {
      const env = { ...process.env };
      delete env.HEROUI_KEY;
      if (override) env.HEROUI_KEY = override;
      const mock = `globalThis.fetch = async (url) => {
        if (new URL(url).searchParams.get('key') !== ${JSON.stringify(expectedKey)}) throw new Error('Unexpected key source');
        return new Response(JSON.stringify({ error: 'fixture download: ' + ${JSON.stringify(expectedKey)} }), { status: 403 });
      };`;
      const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`, new URL('../scripts/install-pro.mjs', import.meta.url).pathname], { cwd, env, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /fixture download: \[redacted\]/);
      assert(!result.stdout.includes(expectedKey) && !result.stderr.includes(expectedKey));
    };
    run(rootKey);
    writeFileSync(join(cwd, '.env.local'), 'HEROUI_KEY=fixture-current-key\n');
    run('fixture-current-key');
    run('fixture-ci-key', 'fixture-ci-key');
    rmSync(join(cwd, '.env.local'));
  }
  rmSync(join(root, '.env.local'));
  writeFileSync(join(root, '.env'), 'HEROUI_KEY=fixture-dotenv-key\n');
  const cwd = join(root, 'frontend');
  const env = { ...process.env };
  delete env.HEROUI_KEY;
  const mock = `globalThis.fetch = async (url) => { throw new Error(new URL(url).searchParams.get('key') === 'fixture-dotenv-key' ? 'dotenv loaded' : 'wrong key'); };`;
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`, new URL('../scripts/install-pro.mjs', import.meta.url).pathname], { cwd, env, encoding: 'utf8' });
  assert.match(result.stderr, /dotenv loaded/);
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
