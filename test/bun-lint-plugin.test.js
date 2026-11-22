'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { createTypeScriptProject } = require('./typescript-project-fixture');

test('Bun loads the plugin and reports duplicate envelopes across files', async (t) => {
  const fixture = await createTypeScriptProject({ testContext: t, files: {
    'a.ts': 'export type First = { id: string; name: string };\n',
    'b.ts': 'export type Second = { id: string; name: string };\n',
  } });
  const pluginPath = path.resolve(__dirname, '..', 'eslint-plugin', 'index.js');
  await fs.writeFile(path.join(fixture, 'bunfig.toml'), [
      '[lint]',
      `plugins = [${JSON.stringify(pluginPath)}]`,
      '',
      '[lint.rules]',
      '"perfect-typescripter/*" = "off"',
      '"perfect-typescripter/no-duplicate-envelope-shape" = "error"',
      '',
  ].join('\n'));

  const lint = spawn('bun', ['lint', '--no-script', '--format=json', 'b.ts'], {
    cwd: fixture,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  lint.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  lint.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const [exitCode] = await once(lint, 'close');
  const output = `${stdout}\n${stderr}`;
  assert.equal(exitCode, 1, output);

  const diagnostics = JSON.parse(stdout).flatMap((file) => file.messages);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.ruleId === 'perfect-typescripter/no-duplicate-envelope-shape'), output);
  assert.ok(diagnostics.some((diagnostic) => /\bFirst\b/.test(diagnostic.message) && /\bSecond\b/.test(diagnostic.message)), output);
});
