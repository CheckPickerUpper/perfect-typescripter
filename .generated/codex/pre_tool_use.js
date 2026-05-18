#!/usr/bin/env node
'use strict';

const nodePath = require('path');

const { payloadsForHook, matcherAcceptsClaudeToolName, readHookPayload } = require('./lib/map-codex-payload-to-claude.js');
const { runCanonicalHook } = require('./lib/run-canonical-hook.js');

const PLUGIN_NAME = "perfect-typescripter";
const PLUGIN_ROOT = nodePath.resolve(__dirname, '../..');
const ROWS = [
  {
    "matcher": "Edit|Write|MultiEdit|mcp__filesystem__write_file|mcp__filesystem__edit_file|mcp__serena__replace_symbol_body|mcp__serena__insert_after_symbol|mcp__serena__insert_before_symbol|mcp__serena__replace_content",
    "scriptPath": "hooks/config_write_guard.js",
    "timeoutMs": 5000
  },
  {
    "matcher": "Edit|Write|MultiEdit|mcp__filesystem__write_file|mcp__filesystem__edit_file|mcp__serena__replace_symbol_body|mcp__serena__insert_after_symbol|mcp__serena__insert_before_symbol|mcp__serena__replace_content",
    "scriptPath": "hooks/typescript_guard.js",
    "timeoutMs": 5000
  },
  {
    "matcher": "Edit|Write|MultiEdit|mcp__filesystem__write_file|mcp__filesystem__edit_file|mcp__serena__replace_symbol_body|mcp__serena__insert_after_symbol|mcp__serena__insert_before_symbol|mcp__serena__replace_content",
    "scriptPath": "hooks/why_tag_guard.js",
    "timeoutMs": 5000
  }
];
const PROTECTED_POLICY_CONFIG_SUFFIXES = [
  ".perfect-typescripter.json",
  ".claude/ai-lab/perfect-typescripter/config.json"
];

function blockWrite(reasonText) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reasonText,
    },
  }) + '\n');
  process.exit(0);
}

function normalizeHookPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function protectedPolicyConfigSuffix(filePath) {
  const normalized = normalizeHookPath(filePath);
  if (!normalized) return null;
  return PROTECTED_POLICY_CONFIG_SUFFIXES.find((suffix) => {
    const normalizedSuffix = normalizeHookPath(suffix);
    return normalized === normalizedSuffix || normalized.endsWith(`/${normalizedSuffix}`);
  }) || null;
}

function denyPolicyConfigWrite(virtualPayload) {
  const filePath = virtualPayload && virtualPayload.tool_input && virtualPayload.tool_input.file_path;
  const matchedSuffix = protectedPolicyConfigSuffix(filePath);
  if (!matchedSuffix) return;
  blockWrite(
    `[${PLUGIN_NAME}] Refusing to edit enforcement config through an AI write tool.\n\n` +
    `Protected file: ${filePath}\n` +
    `Matched policy config: ${matchedSuffix}\n\n` +
    'Use the plugin setup skill or an explicit manual edit instead of weakening policy during a blocked write.'
  );
}

function main() {
  const hookPayload = readHookPayload();
  const virtualPayloads = payloadsForHook(hookPayload);

  for (const virtualPayload of virtualPayloads) {
    denyPolicyConfigWrite(virtualPayload);
    for (const row of ROWS) {
      if (!matcherAcceptsClaudeToolName(row.matcher, virtualPayload.tool_name)) {
        continue;
      }
      const decision = runCanonicalHook({
        scriptPath: nodePath.join(PLUGIN_ROOT, row.scriptPath),
        pluginRoot: PLUGIN_ROOT,
        claudePayload: virtualPayload,
        defaultReason: `Blocked by ${PLUGIN_NAME}.`,
        timeoutMs: row.timeoutMs,
      });
      if (decision.kind === 'deny') {
        blockWrite(`[${PLUGIN_NAME}] ${decision.reason}`);
      }
    }
  }

  process.exit(0);
}

main();
