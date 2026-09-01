const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runOpenBrowserScript(env) {
  const source = fs.readFileSync(path.join(__dirname, 'open-browser.js'), 'utf8');
  const commands = [];
  const logs = [];
  vm.runInNewContext(source, {
    console: { log: (...args) => logs.push(args.join(' ')) },
    process: { env, platform: 'win32' },
    require: (id) => {
      assert.equal(id, 'child_process');
      return { exec: (command) => commands.push(command) };
    },
    setTimeout: (callback) => callback(),
  });
  return { commands, output: logs.join('\n') };
}

test('browser launcher opens and reports the configured frontend port', () => {
  const result = runOpenBrowserScript({ PORT: '3009' });

  assert.match(result.output, /Frontend:\s+http:\/\/localhost:3009/);
  assert.equal(result.commands.length, 1);
  assert.match(result.commands[0], /http:\/\/localhost:3009/);
});
