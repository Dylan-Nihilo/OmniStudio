const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('setup installs runtime dependencies from requirements in a clean venv', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dev-setup.js'), 'utf8');
  const execFileCalls = [];
  const fakeFs = {
    existsSync: (target) => target.endsWith(path.join('frontend', 'node_modules')),
  };

  vm.runInNewContext(source, {
    __dirname,
    console: { log() {}, warn() {}, error() {} },
    process: { platform: 'win32' },
    require: (id) => {
      if (id === 'child_process') {
        return {
          execSync() {},
          execFileSync(command, args) {
            execFileCalls.push({ command, args: [...args] });
          },
        };
      }
      if (id === 'fs') return fakeFs;
      if (id === 'path') return path;
      if (id === 'os') return { platform: () => 'win32' };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  const installCall = execFileCalls.find(({ args }) => args[0] === 'install');
  assert.deepEqual(
    installCall?.args,
    ['install', '-r', 'requirements.txt'],
  );
});

test('setup fails immediately when requirements installation fails', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dev-setup.js'), 'utf8');
  const fakeFs = {
    existsSync: (target) => target.endsWith(path.join('frontend', 'node_modules')),
  };

  assert.throws(
    () => vm.runInNewContext(source, {
      __dirname,
      console: { log() {}, warn() {}, error() {} },
      process: { platform: 'win32' },
      require: (id) => {
        if (id === 'child_process') {
          return {
            execSync() {},
            execFileSync(command, args) {
              if (args[0] === 'install' && args[1] === '-r') {
                throw new Error('requirements install failed');
              }
            },
          };
        }
        if (id === 'fs') return fakeFs;
        if (id === 'path') return path;
        if (id === 'os') return { platform: () => 'win32' };
        throw new Error(`Unexpected module: ${id}`);
      },
    }),
    /requirements install failed/,
  );
});
