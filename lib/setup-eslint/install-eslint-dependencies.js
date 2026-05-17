'use strict';

/**
 * install-eslint-dependencies.js
 *
 * Installs eslint, @typescript-eslint/parser, eslint-plugin-perfect-typescripter
 * (from the bundled plugin source via file: protocol — no npm publish needed),
 * husky, and lint-staged into the user's project. Idempotent: deps that
 * are already declared in package.json with a satisfying version are
 * skipped.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { installCommandFor } = require('./detect-package-manager.js');

const REQUIRED_DEPS_BASE = [
  { name: 'eslint', source: 'eslint@^8' },
  { name: '@typescript-eslint/parser', source: '@typescript-eslint/parser@^6' },
  { name: 'husky', source: 'husky@^9' },
  { name: 'lint-staged', source: 'lint-staged@^15' },
];

function installEslintDependencies(args) {
  const { projectRoot, packageManager, bundledPluginPath } = args;
  const pluginSpec = `eslint-plugin-perfect-typescripter@file:${bundledPluginPath}`;

  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]);

  const toInstall = [];
  for (const dep of REQUIRED_DEPS_BASE) {
    if (!declared.has(dep.name)) toInstall.push(dep.source);
  }
  if (!declared.has('eslint-plugin-perfect-typescripter')) {
    toInstall.push(pluginSpec);
  }

  if (toInstall.length === 0) {
    return { action: 'already-installed', installed: [] };
  }

  const cmd = installCommandFor(packageManager, toInstall);
  execSync(cmd, { cwd: projectRoot, stdio: 'inherit' });
  return { action: 'installed', installed: toInstall, command: cmd };
}

module.exports = { installEslintDependencies };
