#!/usr/bin/env node
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'hooks', 'why_tag_guard.js');

function runHook(filePath, content) {
  const payload = {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
  return spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
  });
}

function tmp(name) {
  return path.join(os.tmpdir(), `typescript-why-tag-guard-test-${process.pid}-${name}`);
}

function denyReason(result) {
  assert.strictEqual(result.status, 0, result.stderr);
  assert.notStrictEqual(result.stdout, '', 'expected deny JSON on stdout');
  return JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
}

{
  const result = runHook(tmp('missing.ts'), 'export function userIdFor(user: User): UserId { return user.id; }\n');
  const reason = denyReason(result);
  assert(reason.includes('[perfect-typescripter] @why TAG REQUIRED - blocked 1 TypeScript exported function.'));
  assert(reason.includes('Missing @why:'));
  assert(reason.includes('- line 1: export function userIdFor(user: User): UserId { return user.id; } -- missing @why tag'));
  assert(reason.includes('Accepted bindings: preceding JSDoc block'));
  assert(reason.includes('plugins/why-tag/skills/why-tag-rules/SKILL.md'));
}

{
  const result = runHook(tmp('what-only.ts'), '/** @why Returns the user id from the user record */\nexport function userIdFor(user: User): UserId { return user.id; }\n');
  const reason = denyReason(result);
  assert(reason.includes('Invalid @why:'));
  assert(reason.includes('restates WHAT without explaining WHY'));
  assert(reason.includes('so callers can'));
}


{
  const result = runHook(tmp('weak-so.ts'), '/** @why Returns the user id so it can be returned */\nexport function userIdFor(user: User): UserId { return user.id; }\n');
  const reason = denyReason(result);
  assert(reason.includes('Invalid @why:'));
  assert(reason.includes('restates WHAT without explaining WHY'));
}

{
  const result = runHook(tmp('weasel.ts'), '/** @why TODO fix this later because callers need more detail */\nexport function userIdFor(user: User): UserId { return user.id; }\n');
  const reason = denyReason(result);
  assert(reason.includes('Invalid @why:'));
  assert(reason.includes('weasel phrase "todo"'));
}

{
  const result = runHook(tmp('valid.ts'), '/** @why Returns the user id so callers can join audit events without opening the user aggregate. */\nexport function userIdFor(user: User): UserId { return user.id; }\n');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
}

console.log('typescript why-tag-guard.test.js passed');
