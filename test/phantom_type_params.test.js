#!/usr/bin/env node
'use strict';

/**
 * phantom_type_params.test.js — covers the PHANTOM TYPE PARAMETER rule
 * added in v1.33.0.
 *
 * The rule fires when a generic declares a type parameter that is never
 * referenced in the body of the declaration. The detector strips
 * comments and string literals before counting `\bNAME\b` occurrences;
 * `=>` is skipped as a token so an arrow type in a type-alias RHS does
 * not prematurely terminate the alias.
 */

const childProcess = require('child_process');
const path = require('path');

const HOOK_SCRIPT_PATH = path.resolve(__dirname, '..', 'hooks', 'typescript_guard.js');
const results = { pass: 0, fail: 0, failures: [] };

function runHook(filePath, source) {
  const payload = { tool_name: 'Write', tool_input: { file_path: filePath, content: source } };
  const out = childProcess.spawnSync('node', [HOOK_SCRIPT_PATH], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000,
  });
  return { status: out.status, stderr: out.stderr || '', stdout: out.stdout || '' };
}

function phantomMatches(result) {
  const all = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 2) return [];
  const re = /PHANTOM TYPE PARAMETER: \w+ '(\w+)' on line \d+ declares generic param '(\w+)'/g;
  const out = [];
  let m;
  while ((m = re.exec(all)) !== null) {
    out.push({ owner: m[1], param: m[2] });
  }
  return out;
}

function assertPhantomFires(result, expected, label) {
  const fired = phantomMatches(result);
  const want = new Set(expected.map(e => `${e.owner}:${e.param}`));
  const got = new Set(fired.map(f => `${f.owner}:${f.param}`));
  const missing = [...want].filter(k => !got.has(k));
  const extra = [...got].filter(k => !want.has(k));
  if (missing.length === 0 && extra.length === 0) {
    results.pass++; process.stdout.write('.'); return;
  }
  results.fail++;
  process.stdout.write('F');
  results.failures.push(`${label}: missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
}

function assertNoPhantom(result, label) {
  const fired = phantomMatches(result);
  if (fired.length === 0) { results.pass++; process.stdout.write('.'); return; }
  results.fail++;
  process.stdout.write('F');
  results.failures.push(`${label}: expected no phantom, got [${fired.map(f => `${f.owner}:${f.param}`).join(', ')}]`);
}

// --- 1. Phantom param in a type alias fires (the WorldStateRegistry
//        case from the Lyte critique). ---

assertPhantomFires(runHook('/tmp/p1.ts', `
type WorldStateRegistry<TKind, TUpsertPayload, TRemoveAnnouncement> = {
  upsert: (payload: TUpsertPayload) => void;
  remove: (announcement: TRemoveAnnouncement) => void;
};
`), [{ owner: 'WorldStateRegistry', param: 'TKind' }],
   'phantom type alias: TKind unused, others used');

// --- 2. All type-alias params used: no phantom fires. ---

assertNoPhantom(runHook('/tmp/p2.ts', `
type Good<T> = { value: T };
type WithTwo<A, B> = { left: A; right: B };
`), 'all type-alias params used');

// --- 3. Phantom param in an interface fires. ---

assertPhantomFires(runHook('/tmp/p3.ts', `
interface Phantom<TBrand> {
  count: number;
}
`), [{ owner: 'Phantom', param: 'TBrand' }],
   'phantom interface: TBrand unused');

// --- 4. Used interface param does not fire. ---

assertNoPhantom(runHook('/tmp/p4.ts', `
interface Box<T> {
  contents: T;
}
`), 'used interface param does not fire');

// --- 5. Phantom function generic fires. ---

assertPhantomFires(runHook('/tmp/p5.ts', `
function makeId<T>(): string {
  return "x";
}
`), [{ owner: 'makeId', param: 'T' }],
   'phantom function generic: T never used in params, return, or body');

// --- 6. Function generic used in param + return does not fire. ---

assertNoPhantom(runHook('/tmp/p6.ts', `
function useT<T>(arg: T): T {
  return arg;
}
`), 'function generic used in param and return');

// --- 7. Param used inside an inline-object parameter annotation does
//        not fire. The function-body finder must skip the param list
//        via balanced-paren extraction so the inline `{ x: T }` does
//        not get mistaken for the body opening brace. ---

assertNoPhantom(runHook('/tmp/p7.ts', `
function inlineObjParam<T>(arg: { x: T }): void {
  return;
}
`), 'inline object param annotation counts as a usage');

// --- 8. Type alias whose RHS contains an arrow type. The arrow `>` must
//        not prematurely close the alias and truncate declText. The
//        third generic param is used in the body — must NOT fire. ---

assertNoPhantom(runHook('/tmp/p8.ts', `
type ArrowParam<A, B, C> = {
  fn: (x: A) => B;
  thunk: () => C;
};
`), 'arrow types in alias RHS do not truncate declText');

// --- 9. Param only appears in a comment: still phantom. The detector
//        strips comments before counting. ---

assertPhantomFires(runHook('/tmp/p9.ts', `
type CommentOnly<TKind> = {
  // TKind is the discriminator
  count: number;
};
`), [{ owner: 'CommentOnly', param: 'TKind' }],
   'comment-only mention does not satisfy usage');

// --- 10. Param only appears inside a string literal: still phantom.
//         The detector strips string contents before counting. ---

assertPhantomFires(runHook('/tmp/p10.ts', `
type StringOnly<TKind> = {
  label: "TKind";
  count: number;
};
`), [{ owner: 'StringOnly', param: 'TKind' }],
   'string-literal-only mention does not satisfy usage');

// --- 11. Two phantom params in one generic: both fire. ---

assertPhantomFires(runHook('/tmp/p11.ts', `
type DoublePhantom<A, B, C> = {
  c: C;
};
`), [{ owner: 'DoublePhantom', param: 'A' }, { owner: 'DoublePhantom', param: 'B' }],
   'two phantom params: both reported');

// --- 12. Param used only in another param's constraint counts as used.
//         <T, U extends T> — T appears in U's constraint => T used. ---

assertNoPhantom(runHook('/tmp/p12.ts', `
type Constrained<T, U extends T> = {
  pair: [T, U];
};
`), 'param referenced in another param\'s constraint counts as used');

// --- 13. Param appearing only in its own constraint is phantom.
//         <K extends string> with K never used elsewhere => phantom. ---

assertPhantomFires(runHook('/tmp/p13.ts', `
type SelfConstraintOnly<K extends string> = {
  count: number;
};
`), [{ owner: 'SelfConstraintOnly', param: 'K' }],
   'param used only in its own constraint is phantom');

// --- 14. The phantom-type rule no longer accepts a `@why phantom` comment
//         as a per-site bypass. Per the why-tag canonical spec, `@why` is
//         documentation, not an escape hatch. The same fixture that used
//         to be suppressed by the tag must now fire; the project-wide
//         exemption mechanism (rules.phantomTypeParams.exemptions.typeParamNames)
//         is the remaining configured opt-out. ---

assertPhantomFires(runHook('/tmp/p14.ts', `
type Branded<T> = { __brand: never }; // @why phantom — branded marker
`), [{ owner: 'Branded', param: 'T' }],
   '@why phantom comment is no longer a per-site bypass; rule fires on the unused T');

// --- Report ---
const total = results.pass + results.fail;
console.log(`\n\n${results.pass}/${total} passed`);
if (results.fail > 0) {
  console.log('\nFailures:');
  for (const f of results.failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
