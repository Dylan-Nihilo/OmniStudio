const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const isWin = os.platform() === 'win32';
const pythonPath = isWin
  ? path.join(__dirname, '..', '.venv', 'Scripts', 'python')
  : path.join(__dirname, '..', '.venv', 'bin', 'python');

const backendPort = process.env.LUMENX_BACKEND_PORT || process.env.NEXT_PUBLIC_BACKEND_PORT || '17177';

const env = {
  ...process.env,
  NO_PROXY: '*.aliyuncs.com,localhost,127.0.0.1',
  no_proxy: '*.aliyuncs.com,localhost,127.0.0.1'
};

const backend = spawn(pythonPath, [
  '-m', 'uvicorn', 'src.apps.comic_gen.api:app',
  '--reload', '--port', backendPort, '--host', '0.0.0.0'
], {
  stdio: 'inherit',
  env
});

backend.on('exit', (code) => process.exit(code || 0));
