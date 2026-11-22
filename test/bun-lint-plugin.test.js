'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('Bun loads the plugin and reports duplicate envelopes across files', async (t) => {
  const fixture = await fs.mkdtemp(path.join(process.env.TEST_SCRATCH || os.tmpdir(), 'perfect-typescripter-bun-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));

  const pluginPath = path.resolve(__dirname, '..', 'eslint-plugin', 'index.js');
  const compilerDirectory = path.dirname(require.resolve('typescript/package.json'));
  await fs.mkdir(path.join(fixture, 'node_modules'));
  await fs.symlink(compilerDirectory, path.join(fixture, 'node_modules', 'typescript'), 'junction');
  await Promise.all([
    fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' })),
    fs.writeFile(path.join(fixture, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, module: 'NodeNext', moduleResolution: 'NodeNext' },
      include: ['*.ts'],
    })),
    fs.writeFile(path.join(fixture, 'bunfig.toml'), [
      '[lint]',
      `plugins = [${JSON.stringify(pluginPath)}]`,
      '',
      '[lint.rules]',
      '"perfect-typescripter/*" = "off"',
      '"perfect-typescripter/no-duplicate-envelope-shape" = "error"',
      '',
    ].join('\n')),
    fs.writeFile(path.join(fixture, 'a.ts'), 'export type First = { id: string; name: string };\n'),
    fs.writeFile(path.join(fixture, 'b.ts'), 'export type Second = { id: string; name: string };\n'),
  ]);

  const lint = spawn('bun', ['lint', '--no-script', '--threads=1', '--format=json', 'a.ts', 'b.ts'], {
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
