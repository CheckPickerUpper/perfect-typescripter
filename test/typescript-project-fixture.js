'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

/**
 * Creates a small project backed by the installed TypeScript compiler API.
 * @param {object} parameters Fixture files and the owning Node test.
 * @returns {Promise<string>} The project directory, removed after the test.
 */
async function createTypeScriptProject({ testContext, files }) {
  const projectRoot = await fs.mkdtemp(path.join(process.env.TEST_SCRATCH || os.tmpdir(), 'perfect-typescripter-project-'));
  testContext.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(projectRoot, 'node_modules'));
  await fs.symlink(path.dirname(require.resolve('typescript/package.json')), path.join(projectRoot, 'node_modules', 'typescript'), 'junction');
  await Promise.all([
    fs.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' })),
    fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, module: 'NodeNext', moduleResolution: 'NodeNext' },
      include: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    })),
    ...Object.entries(files).map(async ([file, source]) => {
      const filename = path.join(projectRoot, file);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, source);
    }),
  ]);
  return projectRoot;
}

module.exports = { createTypeScriptProject };
