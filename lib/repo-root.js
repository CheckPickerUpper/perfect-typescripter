'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MARKERS = ['.git', '.claude-plugin/marketplace.json'];

function findRepoRoot(startDir, markers = DEFAULT_MARKERS) {
  let dir = startDir ? path.resolve(startDir) : process.cwd();
  const root = path.parse(dir).root || '/';
  while (dir && dir !== root && dir !== '.' && dir !== path.dirname(dir)) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function findRepoRootOr(startDir, fallback, markers) {
  return findRepoRoot(startDir, markers) || fallback || process.cwd();
}

module.exports = { findRepoRoot, findRepoRootOr, DEFAULT_MARKERS };
