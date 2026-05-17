#!/usr/bin/env node
'use strict';

/**
 * typescript_guard.test.js — covers POSITIONAL ARGS detector bugs fixed in
 * v1.27.1.
 *
 *   1. The fn-signature regex captured params via `[^)]+` and so truncated
 *      at the first inner `)` of a closure parameter type. A function that
 *      took `(callback: (x: T) => void, b: U)` was read as having one
 *      parameter because everything after the inner `)` was lost.
 *   2. The depth counter treated `>` as a closing angle bracket without
 *      first skipping `=>` as a token. The arrow's `>` pushed depth to -1
 *      and silently swallowed every later separator.
 *
 * Both bugs caused false negatives — fns with closure params and a sibling
 * param were never flagged for POSITIONAL ARGS.
 */

const childProcess = require('child_process');
const path = require('path');

const HOOK_SCRIPT_PATH = path.resolve(__dirname, '..', 'hooks', 'typescript_guard.js');
const results = { pass: 0, fail: 0, failures: [] };

function runHookPayload(payload) {
  const out = childProcess.spawnSync('node', [HOOK_SCRIPT_PATH], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000,
  });
  return { status: out.status, stderr: out.stderr || '', stdout: out.stdout || '' };
}

function runHook(filePath, source) {
  return runHookPayload({ tool_name: 'Write', tool_input: { file_path: filePath, content: source } });
}

function runMultiEditHook(filePath, edits) {
  return runHookPayload({ tool_name: 'MultiEdit', tool_input: { file_path: filePath, edits } });
}

function firedPositional(result) {
  const all = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 2) return null;
  const m = all.match(/POSITIONAL ARGS:[^.]*?has (\d+) positional parameter/);
  return m ? Number(m[1]) : null;
}

function firedViolation(result, pattern) {
  const all = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 2) return false;
  return pattern.test(all);
}

function assertPositionalCount(result, expected, label) {
  const actual = firedPositional(result);
  if (actual === expected) { results.pass++; process.stdout.write('.'); return; }
  results.fail++;
  process.stdout.write('F');
  results.failures.push(`${label}: expected POSITIONAL ARGS count=${expected}, got=${actual}. status=${result.status}`);
}

function assertNoPositional(result, label) {
  const actual = firedPositional(result);
  if (actual === null) { results.pass++; process.stdout.write('.'); return; }
  results.fail++;
  process.stdout.write('F');
  results.failures.push(`${label}: expected no POSITIONAL ARGS but got count=${actual}. status=${result.status}`);
}

function assertViolation(result, pattern, label) {
  if (firedViolation(result, pattern)) { results.pass++; process.stdout.write('.'); return; }
  results.fail++;
  process.stdout.write('F');
  results.failures.push(`${label}: expected violation ${pattern}. status=${result.status}`);
}

function assertNoViolation(result, pattern, label) {
  if (!firedViolation(result, pattern)) { results.pass++; process.stdout.write('.'); return; }
  results.fail++;
  process.stdout.write('F');
  results.failures.push(`${label}: expected no violation ${pattern}. status=${result.status}`);
}

// --- 1. Callback first then plain param: counts as 2 (regression for
//        regex-truncation-at-inner-`)` and arrow-as-depth bugs) ---

assertPositionalCount(runHook('/tmp/x.ts', `
export function processFoo(callback: (x: number) => void, b: string) { return b; }
`), 2, 'callback first then plain b counts as 2 params');

// --- 2. Plain param then callback last: counts as 2 (was already correct) ---

assertPositionalCount(runHook('/tmp/x.ts', `
export function processFoo(a: string, callback: (x: number) => void) { return a; }
`), 2, 'plain a then callback counts as 2 params');

// --- 3. Two callbacks: counts as 2 (arrow-bug regression) ---

assertPositionalCount(runHook('/tmp/x.ts', `
export function processFoo(callback1: (x: number) => void, callback2: (y: string) => boolean) { return callback1; }
`), 2, 'two callbacks count as 2 params');

// --- 4. Three plain params: counts as 3 (control) ---

assertPositionalCount(runHook('/tmp/x.ts', `
export function processFoo(a: string, b: number, c: boolean) { return a; }
`), 3, 'three plain params count as 3');

// --- 5. Single plain param: does NOT fire ---

assertNoPositional(runHook('/tmp/x.ts', `
export function processFoo(a: string) { return a; }
`), 'single param does not fire POSITIONAL ARGS');

// --- 6. Single closure param: does NOT fire ---

assertNoPositional(runHook('/tmp/x.ts', `
export function processFoo(callback: (x: number) => void) { return callback(1); }
`), 'single closure param does not fire POSITIONAL ARGS');

// --- 7. Generic Map<K, V> as single param: does NOT fire (commas inside
//        the generic must not be counted as param separators) ---

assertNoPositional(runHook('/tmp/x.ts', `
export function processFoo(input: Map<string, number>) { return input; }
`), 'Map<K, V> as single param does not over-count generic commas');

// --- 8. else-if ladders are state branching; use switch instead ---

assertViolation(runHook('/tmp/x.ts', `
type ApiError =
  | { kind: "network"; reason: string }
  | { kind: "parse"; reason: string }
  | { kind: "http"; reason: string };

export function normalizeApiError(parsedError: ApiError) {
  if (parsedError.kind === "network") {
    return parsedError;
  } else if (parsedError.kind === "parse") {
    return parsedError;
  }
  return parsedError;
}
`), /IF\/ELSE STATE LADDER/, 'else-if state ladders are blocked');

// --- 9. consecutive if/return branches over discriminants are state ladders ---

assertViolation(runHook('/tmp/x.ts', `
type ApiError =
  | { kind: "network"; reason: string }
  | { kind: "parse"; reason: string }
  | { kind: "http"; reason: string };

export function normalizeApiError(parsedError: ApiError) {
  if (parsedError.kind === "network") {
    return parsedError;
  }
  if (parsedError.kind === "parse") {
    return parsedError;
  }
  return parsedError;
}
`), /IF RETURN STATE LADDER/, 'consecutive discriminant if-return ladders are blocked');

// --- 10. null/undefined comparison ladders are blocked at the branch-shape level ---

assertViolation(runHook('/tmp/x.ts', `
export function normalizeBody(input: { code: string; message: string; detail: string }) {
  const code = input.code;
  const message = input.message;
  const detail = input.detail;

  if (code !== null && message !== null && detail !== null) {
    return { code, message, detail };
  }
  if (code !== null && message !== null) {
    return { code, message };
  }
  if (code !== null) {
    return { code };
  }
  return {};
}
`), /NULLISH COMBINATION LADDER/, 'nullish combination if-return ladders are blocked');

// --- 11. equality ternaries collapse state into two branches ---

assertViolation(runHook('/tmp/x.ts', `
export function labelStatus(input: { status: string }) {
  return input.status === "active" ? "active" : "inactive";
}
`), /STATE TERNARY/, 'equality ternaries are blocked');

// --- 12. nested previous/next DU matrices are blocked even when exhaustive ---

assertViolation(runHook('/tmp/x.ts', `
type PreviousSnapshot =
  | { Kind: "Idle" }
  | { Kind: "Charging" }
  | { Kind: "Overcharging" }
  | { Kind: "Activating" }
  | { Kind: "Active" };

type NextSnapshot =
  | { Kind: "Idle" }
  | { Kind: "Charging" }
  | { Kind: "Overcharging" }
  | { Kind: "Activating" }
  | { Kind: "Active" }
  | { Kind: "ActiveWithoutStageTag" };

export function getAwakeningTagSnapshotChange(snapshotChangeParams: {
  readonly PreviousSnapshot: PreviousSnapshot;
  readonly NextSnapshot: NextSnapshot;
}) {
  const { PreviousSnapshot, NextSnapshot } = snapshotChangeParams;

  switch (NextSnapshot.Kind) {
    case "ActiveWithoutStageTag":
      return { Kind: "AwakeningSnapshotCannotDriveClient", NextSnapshot };
    case "Idle":
      switch (PreviousSnapshot.Kind) {
        case "Idle":
          return { Kind: "AwakeningSnapshotStayedSame" };
        case "Charging":
          return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
        case "Overcharging":
          return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
        case "Activating":
          return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
        case "Active":
          return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
        default:
          return unreachable(PreviousSnapshot);
      }
    case "Charging":
      switch (PreviousSnapshot.Kind) {
        case "Idle":
          return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
        case "Charging":
          return { Kind: "AwakeningSnapshotStayedSame" };
        case "Overcharging":
          return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
        case "Activating":
          return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
        case "Active":
          return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
        default:
          return unreachable(PreviousSnapshot);
      }
    case "Overcharging":
      return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
    case "Activating":
      return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
    case "Active":
      return { Kind: "AwakeningPhaseChanged", PreviousSnapshot, NextSnapshot };
    default:
      return unreachable(NextSnapshot);
  }
}
`), /PRODUCT SWITCH MATRIX/, 'nested previous-next product matrices are blocked');

// --- 13. a single guard if is still allowed; the rule targets ladders ---

assertNoViolation(runHook('/tmp/x.ts', `
export function normalizeCode(input: { code: string }) {
  if (input.code === "") {
    return { kind: "empty" };
  }
  return { kind: "present", code: input.code };
}
`), /IF RETURN STATE LADDER|NULLISH COMBINATION LADDER|IF\/ELSE STATE LADDER/, 'single guard if is not treated as a state ladder');

// --- 14. MultiEdit payloads must scan every replacement string. Claude
//         sends multi-hunk file edits this way; reading only `content`
//         leaves the hook blind because MultiEdit has no content field. ---

assertViolation(runMultiEditHook('/tmp/home-screen.tsx', [
  {
    old_string: '  sort: "newest",',
    new_string: '  sort: "newest_first",\n  platform: null,\n  search: null,',
  },
  {
    old_string: 'apiError={landingCatalogQuery.error}',
    new_string: 'apiError={readApiErrorFromError(landingCatalogQuery.error)}',
  },
]), /'null' used as a value/, 'MultiEdit replacement strings are scanned for null values');

// --- 15. Issue #4: a `name: (...) => ...` callback property whose object
//         literal is passed as a call argument has a signature contextually
//         typed by the callee — the author does not declare it, so POSITIONAL
//         ARGS must not fire. A standalone object's method still fires. ---

assertNoPositional(runHook('/tmp/queries.ts', `
export const usePaymentRequests = () =>
  useJakutaResultQuery({
    queryKey: ["payment-requests"],
    endpointFn: (client, args) => client.GET("/payment-requests", args),
  });
`), 'callback property in a call-argument object literal does not fire POSITIONAL ARGS');

assertNoPositional(runHook('/tmp/queries.ts', `
useJakutaResultMutation({ endpointFn: (client, args) => client.POST(args) });
`), 'single-line callback property in a call argument does not fire POSITIONAL ARGS');

assertNoPositional(runHook('/tmp/queries.ts', `
useJakutaResultQuery({ options: { endpointFn: (client, args) => client.GET(args) } });
`), 'callback in a nested object literal under a call argument does not fire POSITIONAL ARGS');

assertPositionalCount(runHook('/tmp/api.ts', `
const api = { doThing: (a, b) => a + b };
`), 2, 'a standalone object literal method still fires POSITIONAL ARGS (author declares it)');

// --- 16. Issue #5: `| undefined` / `| null` in a function signature or value
//         annotation is library forwarding when the file imports an external
//         package — it cannot fire. The same union inside the file's OWN
//         type/interface declaration still fires (user-declared shape). A file
//         with only relative imports keeps the strict ban everywhere. ---

assertNoViolation(runHook('/tmp/field-error.tsx', `
import { useForm } from "react-hook-form";
export function readFieldError(): string | undefined {
  return undefined;
}
`), /in type signature/, 'signature `| undefined` is allowed when the file imports an external library');

assertNoViolation(runHook('/tmp/date-field.tsx', `
import { DayPicker } from "react-day-picker";
export function toLabel(selected: Date | undefined): string {
  return selected ? "set" : "unset";
}
`), /in type signature/, 'react-day-picker `Date | undefined` param annotation is allowed at the library boundary');

assertViolation(runHook('/tmp/field-error.tsx', `
import { useForm } from "react-hook-form";
export type FieldErrorShape = { message: string | undefined };
`), /in type signature/, 'a `| undefined` inside the file\'s OWN type declaration still fires even with an external import');

assertViolation(runHook('/tmp/local-only.ts', `
import { helper } from "./helper";
export function readThing(): string | undefined {
  return helper();
}
`), /in type signature/, 'signature `| undefined` still fires when the file has only relative imports');

// --- Report ---
const total = results.pass + results.fail;
console.log(`\n\n${results.pass}/${total} passed`);
if (results.fail > 0) {
  console.log('\nFailures:');
  for (const f of results.failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
