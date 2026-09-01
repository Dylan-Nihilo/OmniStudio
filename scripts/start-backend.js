const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const isWin = os.platform() === 'win32';
const DEFAULT_NO_PROXY = [
  'aliyuncs.com',
  '*.aliyuncs.com',
  'kaizo.top',
  '*.kaizo.top',
  'huggingface.co',
  '*.huggingface.co',
  'localhost',
  '127.0.0.1',
].join(',');

function buildBackendSpawnOptions(root = path.resolve(__dirname, '..')) {
  const frontendPort = process.env.PORT || process.env.OMNI_STUDIO_FRONTEND_PORT || '3008';
  const pythonPath = isWin
    ? path.join(root, '.venv', 'Scripts', 'python')
    : path.join(root, '.venv', 'bin', 'python');
  const noProxy = process.env.NO_PROXY
    ? `${process.env.NO_PROXY},${DEFAULT_NO_PROXY}`
    : DEFAULT_NO_PROXY;
  const dataDir = path.join(root, 'output', '.omni-studio');

  return {
    command: pythonPath,
    args: [
      '-m', 'uvicorn', 'src.apps.comic_gen.api:app',
      '--port', process.env.OMNI_STUDIO_BACKEND_PORT || process.env.NEXT_PUBLIC_BACKEND_PORT || '17177',
      '--host', '127.0.0.1',
    ],
    cwd: root,
    env: {
      ...process.env,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
      OMNI_STUDIO_DATA_DIR: process.env.OMNI_STUDIO_DATA_DIR || dataDir,
      OMNI_STUDIO_CONFIG_PATH: process.env.OMNI_STUDIO_CONFIG_PATH || path.join(dataDir, 'config.json'),
      OMNI_STUDIO_LOG_DIR: process.env.OMNI_STUDIO_LOG_DIR || path.join(dataDir, 'logs'),
      OMNI_STUDIO_AUTH_ALLOWED_ORIGINS: process.env.OMNI_STUDIO_AUTH_ALLOWED_ORIGINS
        || `http://localhost:${frontendPort},http://127.0.0.1:${frontendPort}`,
    },
  };
}

function startBackend() {
  const options = buildBackendSpawnOptions();
  const backend = spawn(options.command, options.args, {
    cwd: options.cwd,
    stdio: 'inherit',
    env: options.env,
  });

  backend.on('exit', (code) => process.exit(code || 0));
  return backend;
}

if (require.main === module) {
  startBackend();
}

module.exports = { buildBackendSpawnOptions, startBackend };
