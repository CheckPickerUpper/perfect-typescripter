#!/usr/bin/env node
'use strict';

const path = require('path');

const libDir = path.resolve(__dirname, '..', 'lib');
const { parseHookInput, isEditOrWrite } = require(path.join(libDir, 'hook-input-parser.js'));
const { deny, pass } = require(path.join(libDir, 'hook-output-emitter.js'));

const PROTECTED_CONFIG_SUFFIXES = [
  '.claude/ai-lab/perfect-typescripter/config.json',
  '.perfect-typescripter.json',
];

function normalizedPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function isProtectedConfig(filePath) {
  const normalized = normalizedPath(filePath);
  return PROTECTED_CONFIG_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function main() {
  const parsed = parseHookInput();
  if (!parsed) return pass();
  const { toolName, filePath } = parsed;
  if (!isEditOrWrite(toolName)) return pass();
  if (!isProtectedConfig(filePath)) return pass();

  return deny(
    '[perfect-typescripter] Refusing to edit enforcement config through an AI write tool.\n\n' +
    `Protected file: ${filePath}\n\n` +
    'This config can disable TypeScript invariants, so an agent must not silently add exemptions after a write is blocked. ' +
    'Use the setup-typescripter-config workflow only after explicit user approval, or edit the config outside the AI write path.'
  );
}

main();
