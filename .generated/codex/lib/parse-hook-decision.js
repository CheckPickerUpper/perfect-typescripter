'use strict';

const DEFAULT_DENY_REASON = 'Blocked by perfect-typescripter.';

function stringOrFallback(preferred, fallback) {
  return typeof preferred === 'string' && preferred.length > 0 ? preferred : fallback;
}

function denyDecisionFromHookSpecific(hookSpecificOutput, defaultReason) {
  if (typeof hookSpecificOutput !== 'object' || hookSpecificOutput === null) { return { kind: 'allow' }; }
  if (hookSpecificOutput.permissionDecision !== 'deny') { return { kind: 'allow' }; }
  return { kind: 'deny', reason: stringOrFallback(hookSpecificOutput.permissionDecisionReason, defaultReason) };
}

function denyDecisionFromLegacyShape(parsed, defaultReason) {
  if (parsed.decision !== 'block') { return { kind: 'allow' }; }
  return { kind: 'deny', reason: stringOrFallback(parsed.reason, defaultReason) };
}

function decisionFromHookStdout(rawStdout, defaultReason) {
  const trimmed = (typeof rawStdout === 'string' ? rawStdout : '').trim();
  if (trimmed.length === 0) { return { kind: 'allow' }; }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'allow' };
  }
  if (typeof parsed !== 'object' || parsed === null) { return { kind: 'allow' }; }
  const fromHookSpecific = denyDecisionFromHookSpecific(parsed.hookSpecificOutput, defaultReason);
  if (fromHookSpecific.kind === 'deny') { return fromHookSpecific; }
  return denyDecisionFromLegacyShape(parsed, defaultReason);
}

function decisionFromExitCode(exitCode, stderrText, defaultReason) {
  if (exitCode !== 2) { return { kind: 'allow' }; }
  const trimmed = (typeof stderrText === 'string' ? stderrText : '').trim();
  return { kind: 'deny', reason: trimmed.length === 0 ? defaultReason : trimmed };
}

function combineHookResult({ stdout, stderr, exitCode, defaultReason }) {
  const reason = stringOrFallback(defaultReason, DEFAULT_DENY_REASON);
  const fromStdout = decisionFromHookStdout(stdout, reason);
  if (fromStdout.kind === 'deny') { return fromStdout; }
  return decisionFromExitCode(exitCode, stderr, reason);
}

module.exports = {
  combineHookResult,
};
