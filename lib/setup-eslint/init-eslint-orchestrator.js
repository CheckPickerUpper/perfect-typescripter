#!/usr/bin/env node
'use strict';

/**
 * init-eslint-orchestrator.js
 *
 * Entry point for /setup-eslint. Detects the project, installs deps,
 * merges or writes ESLint config, scaffolds the pre-commit hook, and
 * prints a summary. Non-destructive and idempotent — re-running on the
 * same project is safe.
 *
 * Flags:
 *   --no-precommit    Skip the husky + lint-staged scaffolding.
 *   --dry-run         Print the plan without writing anything.
 */

const path = require('path');
const fs = require('fs');

const { findPackageRoot } = require('./find-package-root.js');
const { detectPackageManager } = require('./detect-package-manager.js');
const { detectEslintConfigStyle } = require('./detect-eslint-config-style.js');
const { installEslintDependencies } = require('./install-eslint-dependencies.js');
const {
  writeFreshFlatConfig,
  writeSiblingFlatConfig,
  alreadyMerged,
} = require('./merge-flat-eslint-config.js');
const { mergeLegacyEslintConfig } = require('./merge-legacy-eslint-config.js');
const { scaffoldPrecommitEslintHook } = require('./scaffold-precommit-eslint-hook.js');

function parseArgs(argv) {
  const out = { precommit: true, dryRun: false };
  for (const a of argv) {
    if (a === '--no-precommit') out.precommit = false;
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

function reportLine(label, msg) {
  process.stdout.write(`  ${label.padEnd(20, ' ')}  ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`/setup-eslint FAILED: ${msg}\n`);
  process.exit(2);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  process.stdout.write('\n/setup-eslint — wiring eslint-plugin-perfect-typescripter\n\n');

  const projectRoot = findPackageRoot(cwd);
  if (!projectRoot) {
    fail(`no package.json found from ${cwd} up to the filesystem root. /setup-eslint requires a Node project.`);
  }
  reportLine('project root:', projectRoot);

  const packageManager = detectPackageManager(projectRoot);
  reportLine('package manager:', packageManager);

  const configStyle = detectEslintConfigStyle(projectRoot);
  reportLine('eslint config:', configStyle.style === 'none' ? 'none (will create flat)' : `${configStyle.style} (${configStyle.path})`);

  const bundledPluginPath = path.resolve(__dirname, '..', '..', 'eslint-plugin');
  if (!fs.existsSync(path.join(bundledPluginPath, 'package.json'))) {
    fail(`bundled eslint plugin not found at ${bundledPluginPath}. Reinstall the perfect-typescripter Claude plugin.`);
  }
  reportLine('bundled plugin:', bundledPluginPath);

  if (args.dryRun) {
    process.stdout.write('\n(dry-run) plan:\n');
    process.stdout.write(`  - install deps via ${packageManager}\n`);
    process.stdout.write(`  - ${configStyle.style === 'none' ? 'create flat' : `merge into ${configStyle.style}`} config\n`);
    if (args.precommit) process.stdout.write('  - scaffold husky + lint-staged pre-commit\n');
    process.stdout.write('\nRe-run without --dry-run to apply.\n');
    return;
  }

  process.stdout.write('\n[1/3] installing dependencies\n');
  const installResult = installEslintDependencies({ projectRoot, packageManager, bundledPluginPath });
  reportLine('install:', installResult.action === 'installed' ? installResult.installed.join(', ') : 'already installed');

  process.stdout.write('\n[2/3] merging eslint config\n');
  const configResult = applyConfigChange({ projectRoot, configStyle });
  reportLine('config:', `${configResult.action} -> ${configResult.path || '(no change)'}`);
  if (configResult.manualBlock) {
    process.stdout.write('\n  Manual merge required for non-JSON legacy config:\n');
    process.stdout.write(configResult.manualBlock + '\n');
  }

  if (args.precommit) {
    process.stdout.write('\n[3/3] scaffolding pre-commit hook\n');
    const precommitResult = scaffoldPrecommitEslintHook(projectRoot);
    reportLine('pre-commit:', precommitResult.precommitPath);
  } else {
    process.stdout.write('\n[3/3] pre-commit skipped (--no-precommit)\n');
  }

  printNextSteps({ projectRoot, configResult });
}

function applyConfigChange(args) {
  const { projectRoot, configStyle } = args;
  if (configStyle.style === 'none') {
    return writeFreshFlatConfig(projectRoot);
  }
  if (configStyle.style === 'flat') {
    if (alreadyMerged(projectRoot)) {
      return { action: 'already-merged', path: configStyle.path };
    }
    return writeSiblingFlatConfig(projectRoot);
  }
  // legacy
  return mergeLegacyEslintConfig(configStyle.path);
}

function printNextSteps(args) {
  const { projectRoot, configResult } = args;
  process.stdout.write('\nDone. Next steps:\n');
  process.stdout.write(`  1. Inspect changes: cd ${projectRoot} && git status\n`);
  process.stdout.write('  2. Run a full lint pass: npx eslint .\n');
  process.stdout.write('  3. Commit the config + lockfile + .husky/ together\n');
  if (configResult.action && configResult.action.startsWith('wrote-sibling')) {
    process.stdout.write('  4. Compose the sibling config into your existing flat config (see file header)\n');
  }
  process.stdout.write('\nFor CI, add a workflow that runs `npx eslint . --max-warnings 0`. Host varies, no default scaffolded.\n');
}

main();
