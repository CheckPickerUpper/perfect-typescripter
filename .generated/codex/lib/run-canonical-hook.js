'use strict';

// Spawns one Claude hook script as a child process, pipes the Claude payload
// into stdin, waits, and returns the combined hook decision. This is the only
// module that touches child_process — everything above it is pure data
// transformation, everything below is the canonical hook itself.

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { combineHookResult } = require('./parse-hook-decision.js');

function runCanonicalHook({ scriptPath, pluginRoot, claudePayload, defaultReason, timeoutMs }) {
  if (!fs.existsSync(scriptPath)) { return { kind: 'allow' }; }
  const child = childProcess.spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(claudePayload),
    encoding: 'utf8',
    timeout: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: typeof pluginRoot === 'string' ? pluginRoot : path.join(scriptPath, '..', '..'),
    },
  });
  return combineHookResult({
    stdout: child.stdout,
    stderr: child.stderr,
    exitCode: child.status,
    defaultReason,
  });
}

module.exports = { runCanonicalHook };
