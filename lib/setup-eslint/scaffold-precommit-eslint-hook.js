'use strict';

/**
 * scaffold-precommit-eslint-hook.js
 *
 * Sets up husky + lint-staged so a commit cannot land if eslint
 * reports any violation on staged .ts / .tsx files. Editor squiggles
 * are advisory; pre-commit is compulsory. The cross-file rules are
 * only systematic when this layer is wired.
 *
 * Idempotent: re-running detects existing husky / lint-staged config
 * and merges rather than overwriting.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PRECOMMIT_LINE = 'npx lint-staged';
const HUSKY_DIR = '.husky';
const PRECOMMIT_PATH_REL = path.join(HUSKY_DIR, 'pre-commit');
const LINT_STAGED_PATTERN = '*.{ts,tsx}';
const LINT_STAGED_COMMAND = 'eslint --max-warnings 0';

function scaffoldPrecommitEslintHook(projectRoot) {
  ensureLintStagedInPackageJson(projectRoot);
  ensureHuskyInstalled(projectRoot);
  ensurePrecommitFile(projectRoot);
  return { action: 'scaffolded', precommitPath: path.join(projectRoot, PRECOMMIT_PATH_REL) };
}

function ensureLintStagedInPackageJson(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg['lint-staged'] = pkg['lint-staged'] || {};
  if (!Array.isArray(pkg['lint-staged'][LINT_STAGED_PATTERN])) {
    const existing = pkg['lint-staged'][LINT_STAGED_PATTERN];
    pkg['lint-staged'][LINT_STAGED_PATTERN] = existing
      ? [].concat(existing, LINT_STAGED_COMMAND)
      : [LINT_STAGED_COMMAND];
  } else if (!pkg['lint-staged'][LINT_STAGED_PATTERN].includes(LINT_STAGED_COMMAND)) {
    pkg['lint-staged'][LINT_STAGED_PATTERN].push(LINT_STAGED_COMMAND);
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function ensureHuskyInstalled(projectRoot) {
  const huskyDirPath = path.join(projectRoot, HUSKY_DIR);
  if (fs.existsSync(huskyDirPath)) return;
  try {
    execSync('npx husky init', { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    fs.mkdirSync(huskyDirPath, { recursive: true });
  }
}

function ensurePrecommitFile(projectRoot) {
  const precommitPath = path.join(projectRoot, PRECOMMIT_PATH_REL);
  let body = '';
  if (fs.existsSync(precommitPath)) {
    body = fs.readFileSync(precommitPath, 'utf-8');
    if (body.includes(PRECOMMIT_LINE)) return;
    if (!body.endsWith('\n')) body += '\n';
    body += `${PRECOMMIT_LINE}\n`;
  } else {
    body = `#!/usr/bin/env sh\n${PRECOMMIT_LINE}\n`;
  }
  fs.mkdirSync(path.dirname(precommitPath), { recursive: true });
  fs.writeFileSync(precommitPath, body);
  try {
    fs.chmodSync(precommitPath, 0o755);
  } catch { /* chmod best-effort; husky writes its own */ }
}

module.exports = { scaffoldPrecommitEslintHook };
