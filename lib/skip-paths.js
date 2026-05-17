'use strict';

const DEFAULT_SKIP_SUBSTRINGS = Object.freeze([
  'node_modules/',
  'target/',
  'dist/',
  'build/',
  '.next/',
  '.turbo/',
  '.cache/',
  'coverage/',
  '__pycache__/',
  '.venv/',
  '__tests__/',
  'test_',
  '_test.',
  '.test.',
  '.spec.',
]);

function shouldSkipPath(filePath, extraSubstrings = []) {
  if (!filePath) return false;
  const haystack = filePath.replace(/\\/g, '/');
  for (const substr of DEFAULT_SKIP_SUBSTRINGS) {
    if (haystack.includes(substr)) return true;
  }
  for (const substr of extraSubstrings) {
    if (haystack.includes(substr)) return true;
  }
  return false;
}

module.exports = { DEFAULT_SKIP_SUBSTRINGS, shouldSkipPath };
