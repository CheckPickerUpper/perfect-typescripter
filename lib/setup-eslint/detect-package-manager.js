'use strict';

/**
 * detect-package-manager.js
 *
 * Returns one of: "pnpm", "yarn", "bun", "npm". Detection precedence:
 * lockfile presence -> packageManager field in package.json -> "npm".
 */

const fs = require('fs');
const path = require('path');

const LOCKFILE_TO_MANAGER = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

function detectPackageManager(projectRoot) {
  for (const [lockfile, manager] of LOCKFILE_TO_MANAGER) {
    if (fs.existsSync(path.join(projectRoot, lockfile))) return manager;
  }
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (typeof pkg.packageManager === 'string') {
        const head = pkg.packageManager.split('@')[0];
        if (['pnpm', 'yarn', 'bun', 'npm'].includes(head)) return head;
      }
    } catch { /* fall through to npm */ }
  }
  return 'npm';
}

function installCommandFor(manager, packagesAsDevDeps) {
  const list = packagesAsDevDeps.join(' ');
  switch (manager) {
    case 'pnpm': return `pnpm add -D ${list}`;
    case 'yarn': return `yarn add -D ${list}`;
    case 'bun':  return `bun add -d ${list}`;
    default:     return `npm install -D ${list}`;
  }
}

module.exports = { detectPackageManager, installCommandFor };
