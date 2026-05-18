#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const nodePath = require('path');

const PLUGIN_NAME = "perfect-typescripter";
const EVENT_NAME = "SessionStart";
const PLUGIN_ROOT = nodePath.resolve(__dirname, '../..');
const ROWS = [
  {
    "matcher": "startup|resume|clear|compact",
    "scriptPath": "hooks/ts-rules-inject.js",
    "timeoutMs": 5000
  }
];

function readHookPayload() {
  try {
    const rawPayload = fs.readFileSync(0, 'utf8');
    return rawPayload.trim() ? JSON.parse(rawPayload) : {};
  } catch {
    return {};
  }
}

function regexpMatches(matcher, matcherCandidateValue) {
  if (matcher === null || matcher === undefined || matcher === '') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(matcherCandidateValue);
  } catch {
    return false;
  }
}

function matcherCandidates(hookPayload) {
  if (EVENT_NAME === 'SessionStart') return [String(hookPayload.source || '')];
  if (EVENT_NAME === 'PostToolUse') {
    const toolName = String(hookPayload.tool_name || '');
    const candidates = [toolName];
    if (toolName === 'apply_patch') candidates.push('Edit', 'Write');
    return candidates;
  }
  return [''];
}

function rowMatches(row, hookPayload) {
  // @why: Stop, UserPromptSubmit, PreCompact, PostCompact have no per-tool matcher;
  // they fire once per event for every registered hook regardless of `row.matcher`.
  if (
    EVENT_NAME === 'Stop' ||
    EVENT_NAME === 'UserPromptSubmit' ||
    EVENT_NAME === 'PreCompact' ||
    EVENT_NAME === 'PostCompact'
  ) return true;
  return matcherCandidates(hookPayload).some((candidate) => regexpMatches(row.matcher, candidate));
}

function runCanonicalHook(row, hookPayload) {
  const scriptPath = nodePath.join(PLUGIN_ROOT, row.scriptPath);
  if (!fs.existsSync(scriptPath)) {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  const hookProcess = childProcess.spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(hookPayload),
    encoding: 'utf8',
    timeout: typeof row.timeoutMs === 'number' && row.timeoutMs > 0 ? row.timeoutMs : 5000,
    cwd: typeof hookPayload.cwd === 'string' && hookPayload.cwd.length > 0 ? hookPayload.cwd : process.cwd(),
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CODEX_PLUGIN_ROOT: PLUGIN_ROOT,
    },
  });
  return {
    stdout: hookProcess.stdout || '',
    stderr: hookProcess.stderr || '',
    exitCode: typeof hookProcess.status === 'number' ? hookProcess.status : 0,
  };
}

function parseStdout(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return { kind: 'empty' };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) return { kind: 'json', parsedPayload: parsed };
  } catch {
    return { kind: 'text', textPayload: trimmed };
  }
  return { kind: 'text', textPayload: trimmed };
}

function appendText(textSegments, textValue) {
  if (typeof textValue === 'string' && textValue.trim().length > 0) textSegments.push(textValue.trim());
}

function collectHookResult(accumulator, hookResult) {
  if (hookResult.exitCode === 2) {
    appendText(accumulator.blockReasons, hookResult.stderr || `Blocked by ${PLUGIN_NAME}.`);
    return;
  }

  const parsed = parseStdout(hookResult.stdout);
  if (parsed.kind === 'text') {
    appendText(accumulator.contextMessages, parsed.textPayload);
    return;
  }
  if (parsed.kind !== 'json') return;

  const canonicalHookJson = parsed.parsedPayload;
  if (canonicalHookJson.decision === 'block') {
    appendText(accumulator.blockReasons, canonicalHookJson.reason || `Blocked by ${PLUGIN_NAME}.`);
  }
  if (canonicalHookJson.continue === false) {
    accumulator.continueFalse = true;
    appendText(accumulator.stopReasons, canonicalHookJson.stopReason || canonicalHookJson.reason || `Stopped by ${PLUGIN_NAME}.`);
  }
  appendText(accumulator.systemMessages, canonicalHookJson.systemMessage);
  appendText(accumulator.contextMessages, canonicalHookJson.additionalContext);

  const hookSpecificOutput = canonicalHookJson.hookSpecificOutput;
  if (typeof hookSpecificOutput === 'object' && hookSpecificOutput !== null) {
    appendText(accumulator.contextMessages, hookSpecificOutput.additionalContext);
    if (hookSpecificOutput.permissionDecision === 'deny') {
      appendText(accumulator.blockReasons, hookSpecificOutput.permissionDecisionReason || `Blocked by ${PLUGIN_NAME}.`);
    }
  }
}

function translatedOutput(accumulator) {
  const translatedHookOutput = {};
  const systemMessages = [...accumulator.systemMessages];
  const contextText = accumulator.contextMessages.join('\n\n');
  const blockReason = accumulator.blockReasons.join('\n\n');

  if (EVENT_NAME === 'Stop') {
    if (contextText) systemMessages.push(contextText);
    if (accumulator.continueFalse) {
      translatedHookOutput.continue = false;
      translatedHookOutput.stopReason = accumulator.stopReasons.join('\n\n') || blockReason || undefined;
    } else if (blockReason) {
      translatedHookOutput.decision = 'block';
      translatedHookOutput.reason = blockReason;
    }
  } else {
    if (blockReason) {
      translatedHookOutput.decision = 'block';
      translatedHookOutput.reason = blockReason;
    }
    if (accumulator.continueFalse) {
      translatedHookOutput.continue = false;
      translatedHookOutput.stopReason = accumulator.stopReasons.join('\n\n') || blockReason || undefined;
    }
    if (contextText) {
      translatedHookOutput.hookSpecificOutput = {
        hookEventName: EVENT_NAME,
        additionalContext: contextText,
      };
    }
  }

  if (systemMessages.length > 0) translatedHookOutput.systemMessage = systemMessages.join('\n\n');
  return translatedHookOutput;
}

function main() {
  const codexHookPayload = readHookPayload();
  const accumulator = {
    contextMessages: [],
    blockReasons: [],
    stopReasons: [],
    systemMessages: [],
    continueFalse: false,
  };

  for (const row of ROWS) {
    if (!rowMatches(row, codexHookPayload)) continue;
    collectHookResult(accumulator, runCanonicalHook(row, codexHookPayload));
  }

  process.stdout.write(JSON.stringify(translatedOutput(accumulator)) + '\n');
  process.exit(0);
}

main();
