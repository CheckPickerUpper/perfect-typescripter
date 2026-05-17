"use strict";

/**
 * Parse TypeScript / JavaScript function signatures.
 *
 * Canonical source for hooks that need to count parameters, extract param
 * names, identify type parameters, or read return types. Handles three
 * subtle cases that inline regex parsers in this repo have collectively
 * gotten wrong over time:
 *
 *   1. Multi-arg generics in parameter types. `(p: Map<K, V>)` must
 *      produce one parameter, not two. Depth tracking covers `< >` along
 *      with `( ) [ ] { }`.
 *   2. Arrow-token guard. The `>` inside an `=>` token is consumed as a
 *      unit so it does not decrement angle-bracket depth. Without this,
 *      `(cb: (x) => void, y)` underflows depth and silently swallows the
 *      next comma.
 *   3. Multi-line generics. `function foo<\n  T,\n  U\n>(args)` is
 *      parsed correctly because the depth walker is line-agnostic.
 *
 * Consumers must `require` this from their vendored copy under
 * `<plugin>/lib/parse-function-signature.js`. Edit the canonical here in
 * `plugins/hook-lib/lib/`, then run `python lab-tools/vendor-hook-lib.py`
 * to propagate.
 */

const OPENERS = "([{<";
const CLOSERS = ")]}>";

function splitOnTopLevelCommas(str) {
  const parts = [];
  let current = "";
  let depth = 0;
  let i = 0;
  while (i < str.length) {
    if (str[i] === "=" && str[i + 1] === ">") {
      current += "=>";
      i += 2;
      continue;
    }
    const ch = str[i];
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
    i++;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function countTopLevelCommas(str) {
  let count = 0;
  let depth = 0;
  let i = 0;
  while (i < str.length) {
    if (str[i] === "=" && str[i + 1] === ">") {
      i += 2;
      continue;
    }
    const ch = str[i];
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth--;
    else if (ch === "," && depth === 0) count++;
    i++;
  }
  return count;
}

function extractBalancedParenBody(code, openParenIndex) {
  if (code[openParenIndex] !== "(") return null;
  let depth = 1;
  let i = openParenIndex + 1;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { body: code.slice(openParenIndex + 1, i - 1), endIndex: i };
}

function findRuntimeParamsBlock(signature) {
  let i = 0;
  let angleDepth = 0;
  while (i < signature.length) {
    const ch = signature[i];
    if (ch === "<") angleDepth++;
    else if (ch === ">") angleDepth--;
    else if (ch === "(" && angleDepth === 0) {
      return extractBalancedParenBody(signature, i);
    }
    i++;
  }
  return null;
}

function paramToName(param) {
  if (!param) return null;
  if (param.startsWith("{") || param.startsWith("[")) return null;
  const trimmed = param.replace(/^\.\.\./, "").trim();
  const beforeAnnotation = trimmed.split(/[?:=]/)[0].trim();
  if (!beforeAnnotation) return null;
  if (beforeAnnotation.startsWith("_")) return null;
  return beforeAnnotation;
}

function extractRuntimeParamNames(signature) {
  const block = findRuntimeParamsBlock(signature);
  if (!block) return [];
  const parts = splitOnTopLevelCommas(block.body);
  const names = [];
  for (const part of parts) {
    const name = paramToName(part);
    if (name) names.push(name);
  }
  return names;
}

function findRuntimeParenIndex(signature) {
  let angleDepth = 0;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i];
    if (ch === "<") angleDepth++;
    else if (ch === ">") angleDepth--;
    else if (ch === "(" && angleDepth === 0) return i;
  }
  return -1;
}

function extractAngleBracketContents(str, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === "<") depth++;
    else if (str[i] === ">") {
      depth--;
      if (depth === 0) return str.slice(startIdx + 1, i);
    }
  }
  return null;
}

function findGenericBlock(signature) {
  const firstParen = findRuntimeParenIndex(signature);
  if (firstParen === -1) return null;
  const before = signature.slice(0, firstParen);
  const firstAngle = before.indexOf("<");
  if (firstAngle === -1) return null;
  return extractAngleBracketContents(before, firstAngle);
}

function extractTypeParamNames(signature) {
  const block = findGenericBlock(signature);
  if (!block) return [];
  const parts = splitOnTopLevelCommas(block);
  const names = [];
  for (const part of parts) {
    const m = part.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (m) names.push(m[1]);
  }
  return names;
}

function extractReturnType(signature) {
  const block = findRuntimeParamsBlock(signature);
  if (!block) return null;
  const after = signature.slice(block.endIndex);
  const m = after.match(/^\s*:\s*([^{=]+?)(?:\s*[{=]|$)/);
  return m ? m[1].trim() : null;
}

module.exports = {
  splitOnTopLevelCommas,
  countTopLevelCommas,
  extractBalancedParenBody,
  findRuntimeParamsBlock,
  findGenericBlock,
  extractRuntimeParamNames,
  extractTypeParamNames,
  extractReturnType,
};
