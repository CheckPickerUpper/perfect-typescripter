'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { ESLint, Linter } = require('eslint');
const parser = require('@typescript-eslint/parser');
const plugin = require('../eslint-plugin');
const { createTypeScriptProject } = require('./typescript-project-fixture');

const sharedMessage = 'Variant literal "OwnerLeft" appears in 3 separate discriminated unions: Second (b.ts:2), First (nested/a.ts:1), Third (z.ts:1). Extract a shared union (e.g. type SharedCause = ... | "OwnerLeft" | ...) and reuse it in each, so adding a new variant later is one line, not 3.';
const cases = [
  {
    name: 'Duplicate envelopes',
    rule: 'no-duplicate-envelope-shape',
    files: {
      'nested/a.ts': 'type First = ({ id: string; name: string });\n',
      'b.ts': '// The declaration starts on the next line.\ninterface Second { id: string; name: string }\n',
    },
    replacement: 'interface Changed { id: number; name: string }\n',
    messages: {
      'nested/a.ts': [{ line: 1, column: 1, message: "Type 'First' has the same shape (id:string | name:string) as Second (b.ts:2). 2 declarations share this envelope — extract a generic and parameterize the differing field types." }],
      'b.ts': [{ line: 2, column: 1, message: "Type 'Second' has the same shape (id:string | name:string) as First (nested/a.ts:1). 2 declarations share this envelope — extract a generic and parameterize the differing field types." }],
    },
  },
  {
    name: 'Shared variant literals',
    rule: 'no-shared-variant-literal-across-discriminated-unions',
    files: {
      'nested/a.ts': 'type First = ("OwnerLeft" | ("OwnerLeft" | "FirstOnly"));\n',
      'b.ts': '// The declaration starts on the next line.\ntype Second = "OwnerLeft" | "SecondOnly";\n',
      'z.ts': 'type Third = "OwnerLeft" | "ThirdOnly";\n',
    },
    replacement: 'type Changed = "Different" | "FirstOnly";\n',
    messages: {
      'nested/a.ts': [{ line: 1, column: 1, message: sharedMessage }],
      'b.ts': [{ line: 2, column: 1, message: sharedMessage }],
      'z.ts': [{ line: 1, column: 1, message: sharedMessage }],
    },
  },
  {
    name: 'Variant prefix drift',
    rule: 'no-variant-prefix-drift',
    files: {
      'nested/a.ts': 'type First = ("PlayerLeft" | "Stays");\n',
      'b.ts': '// The declaration starts on the next line.\ntype Second = "OwnerLeft" | "Waits";\n',
    },
    replacement: 'type Changed = "Different" | "Stays";\n',
    messages: {
      'nested/a.ts': [{ line: 1, column: 1, message: 'Variant "PlayerLeft" (suffix \'Left\') drifts: sibling DUs use different prefixes for the same operation. Conflicting variants: OwnerLeft in Second (b.ts:2), PlayerLeft in First (nested/a.ts:1). Pick one prefix as canonical (the domain glossary decides) and rename the others.' }],
      'b.ts': [{ line: 2, column: 1, message: 'Variant "OwnerLeft" (suffix \'Left\') drifts: sibling DUs use different prefixes for the same operation. Conflicting variants: OwnerLeft in Second (b.ts:2), PlayerLeft in First (nested/a.ts:1). Pick one prefix as canonical (the domain glossary decides) and rename the others.' }],
    },
  },
];

function createLinter({ projectRoot, rules }) {
  return new ESLint({
    cwd: projectRoot,
    overrideConfigFile: true,
    overrideConfig: createRuleConfiguration(rules),
  });
}

function createRuleConfiguration(rules) {
  return [{
    files: ['**/*.{ts,tsx,mts,cts,js}'],
    languageOptions: { parser },
    plugins: { 'perfect-typescripter': plugin },
    rules,
  }];
}

function findings({ projectRoot, results }) {
  return Object.fromEntries(results.map((file) => [
    path.relative(projectRoot, file.filePath).split(path.sep).join('/'),
    file.messages.map(({ line, column, message }) => ({ line, column, message })),
  ]));
}

for (const scenario of cases) {
  test(`${scenario.name} read the nearest TypeScript project`, async (t) => {
    const projectRoot = await createTypeScriptProject({ testContext: t, files: scenario.files });
    const linter = createLinter({ projectRoot, rules: { [`perfect-typescripter/${scenario.rule}`]: 'error' } });

    await t.test('b.ts alone reports its complete findings and no unlinted file', async () => {
      const results = await linter.lintFiles(['b.ts']);
      assert.deepEqual(findings({ projectRoot, results }), { 'b.ts': scenario.messages['b.ts'] });
      assert.ok(results[0].messages.every((message) => message.ruleId === `perfect-typescripter/${scenario.rule}`));
    });

    await t.test('all linted files report the same findings in either file order', async () => {
      const filenames = Object.keys(scenario.files);
      const forward = await linter.lintFiles(filenames);
      const backward = await linter.lintFiles([...filenames].reverse());
      assert.deepEqual(findings({ projectRoot, results: forward }), scenario.messages);
      assert.deepEqual(findings({ projectRoot, results: backward }), scenario.messages);
    });

    await t.test('renaming and changing a partner declaration removes its findings in the same process', async () => {
      const before = await linter.lintFiles(['b.ts']);
      assert.deepEqual(findings({ projectRoot, results: before }), { 'b.ts': scenario.messages['b.ts'] });
      await fs.writeFile(path.join(projectRoot, 'nested/a.ts'), scenario.replacement);
      const results = await linter.lintFiles(['b.ts']);
      assert.deepEqual(findings({ projectRoot, results }), { 'b.ts': [] });
    });
  });
}

test('Editor text replaces only the linted project file', async (t) => {
  const scenario = cases[0];
  const projectRoot = await createTypeScriptProject({ testContext: t, files: scenario.files });
  const linter = createLinter({ projectRoot, rules: { 'perfect-typescripter/no-duplicate-envelope-shape': 'error' } });
  const before = await linter.lintFiles(['b.ts']);
  assert.deepEqual(findings({ projectRoot, results: before }), { 'b.ts': scenario.messages['b.ts'] });
  const edited = await linter.lintText('type Second = { id: number; name: string };', { filePath: 'b.ts' });
  assert.deepEqual(findings({ projectRoot, results: edited }), { 'b.ts': [] });
  const restored = await linter.lintText(scenario.files['b.ts'], { filePath: 'b.ts' });
  assert.deepEqual(findings({ projectRoot, results: restored }), { 'b.ts': scenario.messages['b.ts'] });
});

test('Reusing an ESLint SourceCode object still reads changed partner files', async (t) => {
  const scenario = cases[0];
  const projectRoot = await createTypeScriptProject({ testContext: t, files: scenario.files });
  const configuration = createRuleConfiguration({ 'perfect-typescripter/no-duplicate-envelope-shape': 'error' });
  const linter = new Linter({ cwd: projectRoot });
  const before = linter.verify(scenario.files['b.ts'], configuration, { filename: 'b.ts' });
  assert.equal(before.length, 1);
  assert.equal(before[0].message, scenario.messages['b.ts'][0].message);
  const sourceCode = linter.getSourceCode();
  await fs.writeFile(path.join(projectRoot, 'nested/a.ts'), scenario.replacement);
  assert.deepEqual(linter.verify(sourceCode, configuration, { filename: 'b.ts' }), []);
});

test('Envelope string literals compare by value across quote styles', async (t) => {
  const projectRoot = await createTypeScriptProject({ testContext: t, files: {
    'a.ts': 'type First = ({ id: (\'same\'); name: ("first" | \'second\') });',
    'b.ts': 'type Second = { id: "same"; name: \'first\' | "second" };',
  } });
  const linter = createLinter({ projectRoot, rules: { 'perfect-typescripter/no-duplicate-envelope-shape': 'error' } });
  const messages = (await linter.lintFiles(['b.ts']))[0].messages;
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /same shape \(id:"same" \| name:"first" \| "second"\) as First \(a.ts:1\)/);
});

test('Config membership and extended configs are refreshed between lint calls', async (t) => {
  const scenario = cases[0];
  const projectRoot = await createTypeScriptProject({ testContext: t, files: scenario.files });
  const linter = createLinter({ projectRoot, rules: { 'perfect-typescripter/no-duplicate-envelope-shape': 'error' } });
  assert.equal((await linter.lintFiles(['b.ts']))[0].messages.length, 1);
  await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ files: ['b.ts'] }));
  assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['b.ts']) }), { 'b.ts': [] });
  await fs.writeFile(path.join(projectRoot, 'base.json'), JSON.stringify({ files: ['nested/a.ts', 'b.ts'] }));
  await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ extends: './base.json' }));
  assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['b.ts']) }), { 'b.ts': scenario.messages['b.ts'] });
  await fs.writeFile(path.join(projectRoot, 'base.json'), JSON.stringify({ files: ['b.ts'] }));
  assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['b.ts']) }), { 'b.ts': [] });
});

test('The nearest tsconfig bounds a nested project', async (t) => {
  const projectRoot = await createTypeScriptProject({ testContext: t, files: {
    'nested/b.ts': 'type Second = { id: string; name: string };',
    'a.ts': 'type First = { id: string; name: string };',
  } });
  const linter = createLinter({ projectRoot, rules: { 'perfect-typescripter/no-duplicate-envelope-shape': 'error' } });
  assert.equal((await linter.lintFiles(['nested/b.ts']))[0].messages.length, 1);
  await fs.writeFile(path.join(projectRoot, 'nested/tsconfig.json'), JSON.stringify({ files: ['b.ts'] }));
  assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['nested/b.ts']) }), { 'nested/b.ts': [] });
});

test('New project files participate without changing tsconfig', async (t) => {
  const projectRoot = await createTypeScriptProject({ testContext: t, files: { 'b.ts': 'type Second = { id: string; name: string };' } });
  const linter = createLinter({ projectRoot, rules: { 'perfect-typescripter/no-duplicate-envelope-shape': 'error' } });
  assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['b.ts']) }), { 'b.ts': [] });
  await fs.writeFile(path.join(projectRoot, 'a.ts'), 'type First = { id: string; name: string };');
  const messages = (await linter.lintFiles(['b.ts']))[0].messages;
  assert.equal(messages.length, 1);
  assert.ok(messages[0].message.includes('First (a.ts:1)'));
  await fs.rename(path.join(projectRoot, 'a.ts'), path.join(projectRoot, 'a.js'));
  assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['b.ts']) }), { 'b.ts': [] });
});

test('Envelope thresholds, minimum field counts and ignored names retain their meaning', async (t) => {
  const projectRoot = await createTypeScriptProject({ testContext: t, files: cases[0].files });
  for (const options of [{ threshold: 3 }, { minFields: 3 }, { ignoreNames: ['First'] }]) {
    const linter = createLinter({ projectRoot, rules: { 'perfect-typescripter/no-duplicate-envelope-shape': ['error', options] } });
    assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['b.ts']) }), { 'b.ts': [] });
  }
});

test('Configured discriminator fields, thresholds and ignored literals retain their meaning', async (t) => {
  const projectRoot = await createTypeScriptProject({ testContext: t, files: {
    'a.ts': 'type First = { state: "Exited"; first: string } | { state: "FirstOnly" };',
    'b.ts': 'type Second = ({ "state": ("Exited" | "SecondOnly") });',
    'c.ts': 'type Third = { state: "Exited"; third: string };',
  } });
  const configured = createLinter({ projectRoot, rules: {
    'perfect-typescripter/no-shared-variant-literal-across-discriminated-unions': ['error', { discriminatorFieldNames: ['state'] }],
  } });
  const messages = (await configured.lintFiles(['b.ts']))[0].messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, 'Variant literal "Exited" appears in 3 separate discriminated unions: First (a.ts:1), Second (b.ts:1), Third (c.ts:1). Extract a shared union (e.g. type SharedCause = ... | "Exited" | ...) and reuse it in each, so adding a new variant later is one line, not 3.');
  for (const options of [{}, { discriminatorFieldNames: ['state'], threshold: 4 }, { discriminatorFieldNames: ['state'], ignoreLiterals: ['Exited'] }]) {
    const linter = createLinter({ projectRoot, rules: {
      'perfect-typescripter/no-shared-variant-literal-across-discriminated-unions': ['error', options],
    } });
    assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['b.ts']) }), { 'b.ts': [] });
  }
});

test('Prefix drift requires a different owner and respects ignored suffixes', async (t) => {
  const projectRoot = await createTypeScriptProject({ testContext: t, files: {
    'a.ts': 'type First = "Stays" | "Waits";',
    'b.ts': 'type Second = "PlayerLeft" | "OwnerLeft";',
  } });
  const linter = createLinter({ projectRoot, rules: { 'perfect-typescripter/no-variant-prefix-drift': 'error' } });
  assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['b.ts']) }), { 'b.ts': [] });
  await fs.writeFile(path.join(projectRoot, 'a.ts'), 'type First = "PlayerLeft" | "Stays";');
  const messages = (await linter.lintFiles(['b.ts']))[0].messages;
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /^Variant "OwnerLeft"/);
  const ignored = createLinter({ projectRoot, rules: { 'perfect-typescripter/no-variant-prefix-drift': ['error', { ignoreSuffixes: ['Left'] }] } });
  assert.deepEqual(findings({ projectRoot, results: await ignored.lintFiles(['b.ts']) }), { 'b.ts': [] });
});

const allRules = Object.fromEntries(cases.map((scenario) => [`perfect-typescripter/${scenario.rule}`, 'error']));

test('JavaScript files do not require a TypeScript project', async (t) => {
  const projectRoot = await createTypeScriptProject({ testContext: t, files: { 'a.js': 'export const value = 1;', 'b.ts': 'type Second = string;' } });
  await fs.rm(path.join(projectRoot, 'tsconfig.json'));
  const linter = createLinter({ projectRoot, rules: allRules });
  assert.deepEqual(findings({ projectRoot, results: await linter.lintFiles(['a.js']) }), { 'a.js': [] });
  const messages = (await linter.lintFiles(['b.ts']))[0].messages;
  assert.deepEqual(messages.map((message) => message.ruleId).sort(), Object.keys(allRules).sort());
  for (const message of messages) {
    assert.equal(message.line, 1);
    assert.equal(message.column, 1);
    assert.ok(message.message.includes(`requires tsconfig.json; searched upwards from ${projectRoot}`));
  }
  t.diagnostic(messages[0].message);
});

const projectProblems = [
  {
    name: 'Missing project-local TypeScript',
    prepare: async (projectRoot) => fs.rm(path.join(projectRoot, 'node_modules/typescript')),
    check: (message, projectRoot) => {
      assert.ok(message.includes(`Cannot resolve the TypeScript compiler API ('typescript') from project ${projectRoot}`));
      assert.match(message, /Cannot find module 'typescript'/);
      assert.match(message, /typescript@npm:@typescript\/typescript6@latest/);
    },
  },
  {
    name: 'A TypeScript package without its compiler API',
    prepare: async (projectRoot) => {
      await fs.rm(path.join(projectRoot, 'node_modules/typescript'));
      await fs.mkdir(path.join(projectRoot, 'node_modules/typescript'));
      await fs.writeFile(path.join(projectRoot, 'node_modules/typescript/index.js'), 'module.exports = { version: "7.0.2" };');
    },
    check: (message, projectRoot) => {
      assert.ok(message.includes(path.join(projectRoot, 'node_modules/typescript/index.js')));
      assert.match(message, /version 7\.0\.2.*lacks compiler API members: readConfigFile, parseJsonConfigFileContent, createSourceFile/);
      assert.match(message, /typescript@npm:@typescript\/typescript6@latest/);
    },
  },
  {
    name: 'Malformed tsconfig JSON',
    prepare: async (projectRoot) => fs.writeFile(path.join(projectRoot, 'tsconfig.json'), '{ "compilerOptions":'),
    check: (message, projectRoot) => {
      assert.ok(message.startsWith(`Invalid TypeScript configuration ${path.join(projectRoot, 'tsconfig.json')}: TS`));
      assert.match(message, /expected/);
    },
  },
  {
    name: 'Invalid compiler options',
    prepare: async (projectRoot) => fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'invalid-module' }, files: ['b.ts'] })),
    check: (message, projectRoot) => {
      assert.ok(message.startsWith(`Invalid TypeScript configuration ${path.join(projectRoot, 'tsconfig.json')}: TS6046:`));
      assert.match(message, /Argument for '--module' option must be/);
    },
  },
  {
    name: 'Malformed extended config',
    prepare: async (projectRoot) => {
      await fs.writeFile(path.join(projectRoot, 'broken.json'), '{ "compilerOptions":');
      await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ extends: './broken.json', files: ['b.ts'] }));
    },
    check: (message, projectRoot) => {
      assert.ok(message.includes(`${path.join(projectRoot, 'broken.json').split(path.sep).join('/')}:1:`));
      assert.match(message, /TS1109:.*Expression expected/);
    },
  },
  {
    name: 'Unreadable tsconfig path',
    prepare: async (projectRoot) => {
      await fs.rm(path.join(projectRoot, 'tsconfig.json'));
      await fs.mkdir(path.join(projectRoot, 'tsconfig.json'));
    },
    check: (message, projectRoot) => {
      assert.ok(message.startsWith(`Cannot read TypeScript configuration ${path.join(projectRoot, 'tsconfig.json')} (EISDIR):`));
      assert.match(message, /EISDIR/);
    },
  },
  {
    name: 'Missing extended tsconfig',
    prepare: async (projectRoot) => fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ extends: './missing.json', files: ['b.ts'] })),
    check: (message, projectRoot) => {
      assert.ok(message.startsWith(`Cannot read TypeScript configuration ${path.join(projectRoot, 'missing.json')} (ENOENT):`));
      assert.match(message, /ENOENT/);
    },
  },
  {
    name: 'Unreadable configured source file',
    prepare: async (projectRoot) => fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ files: ['b.ts', 'missing.ts'] })),
    check: (message, projectRoot) => {
      assert.ok(message.startsWith(`Cannot read TypeScript project file ${path.join(projectRoot, 'missing.ts')} (ENOENT):`));
      assert.match(message, /ENOENT/);
    },
  },
];

for (const problem of projectProblems) {
  test(`${problem.name} reports its path and cause for each enabled rule`, async (t) => {
    const projectRoot = await createTypeScriptProject({ testContext: t, files: { 'b.ts': 'type Second = string;' } });
    await problem.prepare(projectRoot);
    const linter = createLinter({ projectRoot, rules: allRules });
    const messages = (await linter.lintFiles(['b.ts']))[0].messages;
    assert.deepEqual(messages.map((message) => message.ruleId).sort(), Object.keys(allRules).sort());
    t.diagnostic(messages[0].message);
    for (const message of messages) problem.check(message.message, projectRoot);
  });
}
