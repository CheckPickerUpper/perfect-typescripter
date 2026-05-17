'use strict';

/**
 * detect-eslint-config-style.js
 *
 * Inspects the project root and returns one of:
 *   { style: 'flat',   path: '<projectRoot>/eslint.config.{js,mjs,cjs,ts}' }
 *   { style: 'legacy', path: '<projectRoot>/.eslintrc.{json,js,cjs,yaml,yml}' }
 *   { style: 'none',   path: null }
 *
 * Flat config wins if both exist, since ESLint v9 ignores legacy when
 * a flat config is present.
 */

const fs = require('fs');
const path = require('path');

const FLAT_CONFIG_FILENAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
];

const LEGACY_CONFIG_FILENAMES = [
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
];

function detectEslintConfigStyle(projectRoot) {
  for (const name of FLAT_CONFIG_FILENAMES) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) return { style: 'flat', path: candidate };
  }
  for (const name of LEGACY_CONFIG_FILENAMES) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) return { style: 'legacy', path: candidate };
  }
  return { style: 'none', path: null };
}

module.exports = { detectEslintConfigStyle, FLAT_CONFIG_FILENAMES, LEGACY_CONFIG_FILENAMES };
