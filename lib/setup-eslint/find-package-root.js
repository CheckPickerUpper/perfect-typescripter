'use strict';

/**
 * find-package-root.js
 *
 * Walks up from the given start directory to the nearest `package.json`
 * and returns the directory containing it. Returns null if none is
 * found before the filesystem root.
 */

const fs = require('fs');
const path = require('path');

function findPackageRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  const root = path.parse(dir).root || '/';
  while (dir !== root && dir !== '.' && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  if (fs.existsSync(path.join(root, 'package.json'))) return root;
  return null;
}

module.exports = { findPackageRoot };
