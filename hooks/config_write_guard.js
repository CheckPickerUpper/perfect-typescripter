#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const libDir = path.resolve(__dirname, '..', 'lib');
const { parseHookInput, isEditOrWrite } = require(path.join(libDir, 'hook-input-parser.js'));
const { deny, pass } = require(path.join(libDir, 'hook-output-emitter.js'));

const PROTECTED_CONFIG_SUFFIXES = [
  '.claude/ai-lab/perfect-typescripter/config.json',
  '.perfect-typescripter.json',
];

const APPROVAL_MARKER_NAME = '.config-write-approved';
const APPROVAL_MARKER_TTL_MS = 60_000;

function normalizedPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function isProtectedConfig(filePath) {
  const normalized = normalizedPath(filePath);
  return PROTECTED_CONFIG_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * @why opens a single-shot, time-bounded bypass for the setup-typescripter-config
 * skill so its prescribed Step 3 Write does not hit the same guard the skill
 * itself instructs the user to invoke. The marker is created by the skill via
 * Bash (which this hook does not match) right after AskUserQuestion approval,
 * so the user has explicitly authorized the next Write inside a 60s window.
 * Without this, the skill's documented workflow is unreachable and users are
 * pushed toward worse workarounds (raw Bash heredoc that bypasses the guard
 * entirely with no per-write user-approval handshake).
 */
function consumeFreshApprovalMarker(targetFilePath) {
  const markerPath = path.join(path.dirname(targetFilePath), APPROVAL_MARKER_NAME);
  let stat;
  try { stat = fs.statSync(markerPath); }
  catch { return false; }
  const ageMs = Date.now() - stat.mtimeMs;
  if (ageMs < 0 || ageMs > APPROVAL_MARKER_TTL_MS) {
    try { fs.unlinkSync(markerPath); } catch { /* @why marker cleanup is best-effort; stale marker would expire on next read anyway */ }
    return false;
  }
  try { fs.unlinkSync(markerPath); }
  catch { return false; }
  return true;
}

function main() {
  const parsed = parseHookInput();
  if (!parsed) return pass();
  const { toolName, filePath } = parsed;
  if (!isEditOrWrite(toolName)) return pass();
  if (!isProtectedConfig(filePath)) return pass();
  if (consumeFreshApprovalMarker(filePath)) return pass();

  return deny(
    '[perfect-typescripter] Refusing to edit enforcement config through an AI write tool.\n\n' +
    `Protected file: ${filePath}\n\n` +
    'This config can disable TypeScript invariants, so an agent must not silently add exemptions after a write is blocked. ' +
    'Use the setup-typescripter-config skill, which gets explicit user approval via AskUserQuestion ' +
    `then touches a single-shot ${APPROVAL_MARKER_NAME} marker (TTL ${APPROVAL_MARKER_TTL_MS / 1000}s) in the same dir as the target.`
  );
}

main();
