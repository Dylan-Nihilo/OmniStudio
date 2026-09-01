const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildBackendSpawnOptions } = require('./start-backend');

test('backend starts from repository root without reload workers and keeps external AI hosts reachable', () => {
  const root = path.resolve(__dirname, '..');
  const options = buildBackendSpawnOptions(root);

  assert.equal(options.cwd, root);
  assert.ok(options.env.NO_PROXY.includes('aliyuncs.com'));
  assert.ok(options.env.NO_PROXY.includes('kaizo.top'));
  assert.ok(options.env.NO_PROXY.includes('huggingface.co'));
  assert.ok(!options.args.includes('--reload'));
  assert.deepEqual(options.args.slice(-2), ['--host', '127.0.0.1']);
});

test('backend command uses the configured backend port', () => {
  const previous = process.env.OMNI_STUDIO_BACKEND_PORT;
  process.env.OMNI_STUDIO_BACKEND_PORT = '18177';
  try {
    const options = buildBackendSpawnOptions();
    assert.ok(options.args.includes('18177'));
  } finally {
    if (previous === undefined) delete process.env.OMNI_STUDIO_BACKEND_PORT;
    else process.env.OMNI_STUDIO_BACKEND_PORT = previous;
  }
});

test('backend persists development auth state inside the repository output directory', () => {
  const root = path.resolve(__dirname, '..');
  const options = buildBackendSpawnOptions(root);

  assert.equal(options.env.OMNI_STUDIO_DATA_DIR, path.join(root, 'output', '.omni-studio'));
  assert.equal(options.env.OMNI_STUDIO_CONFIG_PATH, path.join(root, 'output', '.omni-studio', 'config.json'));
  assert.equal(options.env.OMNI_STUDIO_LOG_DIR, path.join(root, 'output', '.omni-studio', 'logs'));
});

test('backend allows the configured frontend port without extra auth setup', () => {
  const previousPort = process.env.PORT;
  const previousOrigins = process.env.OMNI_STUDIO_AUTH_ALLOWED_ORIGINS;
  process.env.PORT = '3009';
  delete process.env.OMNI_STUDIO_AUTH_ALLOWED_ORIGINS;
  try {
    const options = buildBackendSpawnOptions();
    assert.equal(
      options.env.OMNI_STUDIO_AUTH_ALLOWED_ORIGINS,
      'http://localhost:3009,http://127.0.0.1:3009',
    );
  } finally {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    if (previousOrigins === undefined) delete process.env.OMNI_STUDIO_AUTH_ALLOWED_ORIGINS;
    else process.env.OMNI_STUDIO_AUTH_ALLOWED_ORIGINS = previousOrigins;
  }
});
