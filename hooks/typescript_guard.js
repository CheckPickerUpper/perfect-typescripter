#!/usr/bin/env node
'use strict';
/**
 * Perfect TypeScripter - Enforces Rust-style algebraic types in TypeScript/RobloxTS.
 *
 * Bans: optionals, booleans, null, undefined, any, unknown, type assertions, enums.
 * Forces: discriminated unions with exhaustive switches for all domain states.
 * Exempts: Tauri plugin-store API (.get(), as assertions, unknown on store lines).
 */

const fs = require('fs');
const path = require('path');

const libDir = path.resolve(__dirname, '..', 'lib');
const { parseHookInput, isEditOrWrite, extractContent } = require(path.join(libDir, 'hook-input-parser.js'));
const { deny, pass } = require(path.join(libDir, 'hook-output-emitter.js'));
const {
  extractBalancedParenBody,
  countTopLevelCommas,
} = require(path.join(libDir, 'parse-function-signature.js'));

// ── CONFIG LOADING ──────────────────────────────────────────────────────

function loadConfig(projectRoot) {
  const defaults = getDefaultConfig();

  // Try default config file from plugin
  const defaultConfigPath = path.join(__dirname, '../config/default.json');
  let base = defaults;
  if (fs.existsSync(defaultConfigPath)) {
    try {
      base = mergeConfig(defaults, JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8')));
    } catch { /* use defaults */ }
  }

  // Merge project-specific overrides on top
  const projectConfigPath = path.join(projectRoot, '.claude', 'ai-lab', 'perfect-typescripter', 'config.json');
  if (fs.existsSync(projectConfigPath)) {
    try {
      return mergeConfig(base, JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8')));
    } catch { /* use base */ }
  }

  return base;
}

function getDefaultConfig() {
  return {
    ignorePaths: [],
    rules: {
      degenerateCollapse:   { enabled: true, exemptFunctions: [] },
      booleanFields:        { enabled: true, exemptions: { fieldNames: [
        'refreshing', 'editable', 'multiline', 'scrollEnabled', 'horizontal',
        'secureTextEntry', 'showsVerticalScrollIndicator', 'showsHorizontalScrollIndicator',
        'keyboardDismissMode', 'bounces', 'pagingEnabled', 'pointerEvents',
        'collapsable', 'focusable', 'accessible', 'disabled', 'loading',
        'checked', 'selected', 'required', 'readOnly', 'hidden', 'open',
        'autoFocus', 'autoPlay', 'controls', 'loop', 'muted', 'playsInline',
        'allowFullScreen', 'noValidate', 'formNoValidate', 'multiple', 'draggable',
        'spellCheck', 'contentEditable'
      ], typeNames: [], tsxFiles: true } },
      booleanParams:        { enabled: true, exemptions: { privateFunctions: true } },
      booleanReturns:       { enabled: true },
      nullUndefined:        { enabled: true, exemptions: { functionNames: [], commentTag: '@api-boundary' } },
      optionalProperties:   { enabled: true, exemptions: { commentTag: '@api-boundary' } },
      optionalChaining:     { enabled: true },
      anyUnknown:           { enabled: true },
      typeAssertions:       { enabled: true, allowConst: true, allowBrandedTypes: true, exemptions: { allowedTypes: [] } },
      stringWidening:       { enabled: true, exemptions: { commentTag: '@why widen' } },
      doubleBang:           { enabled: true },
      enums:                { enabled: true },
      exhaustiveSwitches:   { enabled: true },
      fallthroughGrouping:  { enabled: true },
      productSwitchMatrix:  { enabled: true, minRepeatedReturnKind: 3 },
      stateBranching:       { enabled: true, exemptions: { allowedFiles: [], allowedDirectories: [] } },
      resultPatterns:       { enabled: true, bannedNames: ['Success', 'Failed', 'Ok', 'Error'] },
      ifOnField:            { enabled: true, suspiciousNames: [] },
      positionalArgs:       { enabled: true, exemptPrivateFunctions: true },
      phantomTypeParams:    { enabled: true, exemptions: { typeParamNames: [], commentTag: '@why phantom' } }
    },
    projectOverrides: {
      exemptFunctions: [],
      exemptTypes: []
    }
  };
}

function mergeArrayFields(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (Array.isArray(v) && Array.isArray(target[k])) {
      target[k] = [...new Set([...target[k], ...v])];
    } else {
      target[k] = v;
    }
  }
}

function mergeConfig(defaults, overrides) {
  const merged = JSON.parse(JSON.stringify(defaults));
  if (!overrides || typeof overrides !== 'object') return merged;
  if (overrides.rules && typeof overrides.rules === 'object') {
    for (const [key, val] of Object.entries(overrides.rules)) {
      if (merged.rules[key] && typeof val === 'object') {
        if (val.exemptions && merged.rules[key].exemptions && typeof val.exemptions === 'object') {
          mergeArrayFields(merged.rules[key].exemptions, val.exemptions);
          const rest = { ...val };
          delete rest.exemptions;
          Object.assign(merged.rules[key], rest);
        } else {
          Object.assign(merged.rules[key], val);
        }
      } else {
        merged.rules[key] = val;
      }
    }
  }
  // Support old config keys → map to new keys
  if (merged.rules.booleans) {
    const old = merged.rules.booleans;
    if (old.enabled === false) {
      merged.rules.booleanFields.enabled = false;
      merged.rules.booleanParams.enabled = false;
      merged.rules.booleanReturns.enabled = false;
    }
    if (old.exemptions) {
      Object.assign(merged.rules.booleanFields.exemptions || {}, old.exemptions);
    }
    delete merged.rules.booleans;
  }
  if (merged.rules.optionals) {
    const old = merged.rules.optionals;
    if (old.enabled === false) {
      merged.rules.optionalProperties.enabled = false;
      merged.rules.optionalChaining.enabled = false;
    }
    delete merged.rules.optionals;
  }
  if (overrides.projectOverrides) {
    Object.assign(merged.projectOverrides, overrides.projectOverrides);
  }
  if (Array.isArray(overrides.ignorePaths)) {
    merged.ignorePaths = [...new Set([...(merged.ignorePaths || []), ...overrides.ignorePaths.map(e => e.path || e).filter(Boolean)])];
    merged._ignoreReasons = {};
    for (const entry of overrides.ignorePaths) {
      if (entry && typeof entry === 'object' && entry.path && entry.reason) {
        merged._ignoreReasons[entry.path] = entry.reason;
      }
    }
  }
  return merged;
}

// ── TAURI STORE EXEMPTION ──────────────────────────────────────────────

const TAURI_STORE_IMPORT = /from\s+['"]@tauri-apps\/plugin-store['"]/;

function hasTauriStoreImport(code) {
  return TAURI_STORE_IMPORT.test(code);
}

// ── LIBRARY-BOUNDARY DETECTION ─────────────────────────────────────────
// @why External libraries' documented surfaces are routinely `T | undefined`
// valued and the consumer cannot reshape them into a DU upstream —
// react-hook-form's `errors[field]` is `FieldError | undefined`,
// react-day-picker's `selected` is `Date | undefined`, and the same shape
// recurs across the ecosystem. The structural signal that a `| undefined` in
// a function signature / value annotation is library forwarding rather than a
// user-declared shape is simply: the file imports from an external package.
// This is import-gated and cannot be faked — an AI can't tag its way past it,
// it would have to add a real import of a real package. The rule's invariant
// ("ban DU-collapsing shapes YOU DECLARE") still holds: `nullUndefined` keeps
// firing on `type X = ... | undefined` / `interface X { foo: ... | undefined }`
// declarations inside such files, because those ARE user-declared shapes —
// only signatures and value annotations forwarding an upstream type are
// allowed. There is no per-library list and no per-file allowlist to maintain.
//
// "External" means a bare module specifier: `from 'pkg'` / `from '@scope/pkg'`,
// not a relative (`./`, `../`) or alias (`@/`, `/`) path into the project's
// own source.
const EXTERNAL_IMPORT_RE = /\bfrom\s+['"`](?![./]|@\/)[^'"`]+['"`]/;
function fileImportsExternalLibrary(code) {
  return EXTERNAL_IMPORT_RE.test(code);
}

// Track whether a line index sits inside a `type X = ...` alias or `interface X { ... }`
// declaration block, where `| undefined` / `| null` is the user declaring the shape.
function indexTypeDeclLines(code) {
  const lines = code.split('\n');
  const insideTypeDecl = new Array(lines.length).fill(false);
  const TYPE_OR_INTERFACE = /^\s*(?:export\s+)?(?:type|interface)\s+\w+/;
  let active = false;
  let braceDepth = 0;
  let awaitingSemicolon = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!active && TYPE_OR_INTERFACE.test(line)) {
      active = true;
      braceDepth = 0;
      awaitingSemicolon = !line.includes('{');
    }
    if (active) {
      insideTypeDecl[i] = true;
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
      }
      if (!awaitingSemicolon && braceDepth <= 0 && line.includes('}')) {
        active = false;
        braceDepth = 0;
      } else if (awaitingSemicolon && /;\s*$/.test(line)) {
        active = false;
        awaitingSemicolon = false;
      }
    }
  }
  return insideTypeDecl;
}

// ── DETECTORS ──────────────────────────────────────────────────────────

function detectNullUndefined(code, config) {
  if (!config.rules.nullUndefined.enabled) return [];

  const violations = [];
  const exemptFns = new Set([
    ...(config.rules.nullUndefined.exemptions?.functionNames || []),
    ...(config.projectOverrides?.exemptFunctions || []),
  ]);
  const commentTag = config.rules.nullUndefined.exemptions?.commentTag || '@api-boundary';
  const libraryBoundary = fileImportsExternalLibrary(code);
  const insideTypeDecl = libraryBoundary ? indexTypeDeclLines(code) : null;

  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip lines with the exemption comment tag
    if (commentTag && line.includes(commentTag)) continue;

    // @why Narrow library-boundary allowance: in files importing a library
    // whose surface is inherently `T | undefined` valued (react-hook-form,
    // react-day-picker), only fire on `| undefined` / `| null` inside a
    // user-authored `type` / `interface` declaration. Function signatures
    // and value annotations in such files are forwarding upstream library
    // shapes (FieldError | undefined, Date | undefined), not declaring new ones.
    if (libraryBoundary && !insideTypeDecl[i]) continue;

    // Skip lines inside exempt functions (check preceding function declaration)
    if (exemptFns.size > 0) {
      let exempt = false;
      for (const fn of exemptFns) {
        if (line.includes(fn)) { exempt = true; break; }
      }
      // Also check: is this a return type of an exempt function?
      if (!exempt) {
        const prevLines = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
        for (const fn of exemptFns) {
          if (prevLines.includes(`function ${fn}`) || prevLines.includes(`${fn}(`)) {
            exempt = true; break;
          }
        }
      }
      if (exempt) continue;
    }

    if (/:\s*([^=\n]+?)\s*\|\s*null\b/.test(line)) {
      violations.push(
        "BLOCKED: '| null' in type signature. null should not exist — create discriminated unions upstream that eliminate it."
      );
    }

    if (/:\s*([^=\n]+?)\s*\|\s*undefined\b/.test(line)) {
      violations.push(
        "BLOCKED: '| undefined' in type signature. undefined should not exist — create discriminated unions upstream that eliminate it."
      );
    }

    // Detect null/undefined as value literals (ternaries, assignments, returns, array elements)
    // Skip: typeof x === "undefined", typeof x !== "undefined" (runtime type checks)
    // Skip: === null, !== null, === undefined, !== undefined (comparisons)
    // Skip: comments, string literals
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
      // Strip string literals to avoid false positives on "undefined"/"null" in strings
      const noStrings = line.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '""');

      // Match undefined/null as values, but NOT in comparisons or typeof checks
      if (/\bundefined\b/.test(noStrings)) {
        // Allow: typeof x === "undefined" (already stripped to typeof x === "")
        // Allow: === undefined, !== undefined, == undefined, != undefined (comparisons)
        // Allow: void 0 patterns and type annotations (already caught above)
        if (!/typeof\b/.test(noStrings) &&
            !/[!=]==?\s*undefined\b/.test(noStrings) &&
            !/\bundefined\s*[!=]==?/.test(noStrings) &&
            !/:\s*([^=\n]+?)\s*\|\s*undefined\b/.test(noStrings)) {
          violations.push(
            "BLOCKED: 'undefined' used as a value. undefined should not exist at runtime — design discriminated unions so every branch carries a real value."
          );
        }
      }

      if (/\bnull\b/.test(noStrings)) {
        if (!/[!=]==?\s*null\b/.test(noStrings) &&
            !/\bnull\s*[!=]==?/.test(noStrings) &&
            !/:\s*([^=\n]+?)\s*\|\s*null\b/.test(noStrings)) {
          violations.push(
            "BLOCKED: 'null' used as a value. null should not exist at runtime — design discriminated unions so every branch carries a real value."
          );
        }
      }
    }
  }

  return violations;
}

function detectOptionalProperties(code, config) {
  if (!config.rules.optionalProperties.enabled) return [];

  const violations = [];
  const commentTag = config.rules.optionalProperties.exemptions?.commentTag || '@api-boundary';

  const lines = code.split('\n');
  for (const line of lines) {
    if (commentTag && line.includes(commentTag)) continue;

    const optionalProps = line.match(/(\w+)\?\s*:/g);
    if (optionalProps) {
      for (const match of optionalProps) {
        const propName = match.match(/(\w+)\?/)[1];
        violations.push(
          `BLOCKED: Optional property '${propName}?:' detected. Optional properties should not exist — create discriminated unions upstream that eliminate them.`
        );
      }
    }
  }

  return violations;
}

function detectOptionalChaining(code, config) {
  if (!config.rules.optionalChaining.enabled) return [];

  // @why Narrow library-boundary allowance: reading an inherently optional
  // library surface (`errors[field]?.message`, `selected?.toISOString()`)
  // requires `?.` — there is no DU reshape the consumer can apply upstream.
  // Every `?.` in a file wired to such a library is library consumption, so
  // the file-scoped allowance is safe. Files that do NOT import one retain the
  // strict ban — the invariant still holds for user-owned shapes.
  if (fileImportsExternalLibrary(code)) return [];

  const violations = [];

  const chainCount = (code.match(/\?\./g) || []).length;
  if (chainCount > 0) {
    violations.push(
      `BLOCKED: Optional chaining '?.' detected (${chainCount} occurrence(s)). '?.' should not exist — create discriminated unions upstream and use switch statements.`
    );
  }

  return violations;
}

function detectBooleanFields(code, config) {
  if (!config.rules.booleanFields.enabled) return [];

  const violations = [];
  const exemptFields = new Set(config.rules.booleanFields.exemptions?.fieldNames || []);
  const exemptTypes = new Set(config.rules.booleanFields.exemptions?.typeNames || []);
  
  const lines = code.split('\n');
  let inType = false;
  let braceDepth = 0;
  let currentTypeName = '';
  let booleanFields = [];
  
  const TYPE_DECL_START = /^(?:export\s+)?(?:type|interface)\s+(\w+)/;
  const BOOLEAN_FIELD = /(?:readonly\s+)?(\w+)\??\s*:\s*boolean/g;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const typeMatch = line.match(TYPE_DECL_START);
    if (typeMatch) {
      if (inType && booleanFields.length > 0 && !exemptTypes.has(currentTypeName)) {
        for (const field of booleanFields) {
          violations.push(
            `BOOLEAN BLINDNESS: Type '${currentTypeName}' has boolean field '${field.name}' on line ${field.line}.\n` +
            `    Use discriminated union: {kind: 'yes'} | {kind: 'no'}`
          );
        }
      }
      
      inType = true;
      currentTypeName = typeMatch[1];
      booleanFields = [];
      
      if (!line.includes('{')) continue;
    }
    
    if (inType) {
      for (const char of line) {
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
      }
      
      let match;
      BOOLEAN_FIELD.lastIndex = 0;
      while ((match = BOOLEAN_FIELD.exec(line)) !== null) {
        const fieldName = match[1];
        if (!exemptFields.has(fieldName)) {
          booleanFields.push({ name: fieldName, line: i + 1 });
        }
      }
      
      if (braceDepth <= 0 && inType && line.includes('}')) {
        if (booleanFields.length > 0 && !exemptTypes.has(currentTypeName)) {
          for (const field of booleanFields) {
            violations.push(
              `BOOLEAN BLINDNESS: Type '${currentTypeName}' has boolean field '${field.name}' on line ${field.line}.\n` +
              `    Use discriminated union instead.`
            );
          }
        }
        inType = false;
        booleanFields = [];
        braceDepth = 0;
      }
    }
  }
  
  return violations;
}

function detectBooleanParams(code, config) {
  if (!config.rules.booleanParams.enabled) return [];

  const violations = [];
  const exemptPrivate = config.rules.booleanParams.exemptions?.privateFunctions !== false;
  
  const boolParamMatches = code.matchAll(/function\s+(\w+)[^(]*\(([^)]*\b\w+\s*:\s*boolean\b[^)]*)\)/g);
  for (const match of boolParamMatches) {
    const fnName = match[1];
    
    // Skip private functions (starting with _)
    if (exemptPrivate && fnName.startsWith('_')) {
      continue;
    }
    
    violations.push(
      `BOOLEAN BLINDNESS: Function '${fnName}' has parameter with type 'boolean'. ` +
      "Use a two-variant discriminated union instead: {kind: 'yes'} | {kind: 'no'}"
    );
  }
  
  return violations;
}

function detectBooleanReturns(code, config) {
  if (!config.rules.booleanReturns.enabled) return [];
  
  const violations = [];
  
  const boolReturns = code.match(/function\s+(\w+)[^(]*\([^)]*\)\s*:\s*boolean\b/g);
  if (boolReturns) {
    for (const match of boolReturns) {
      const funcName = match.match(/function\s+(\w+)/)[1];
      if (!/^(is|has|can|should|contains|starts|ends|eq|matches)/.test(funcName)) {
        violations.push(
          `BOOLEAN BLINDNESS: Function '${funcName}' returns boolean. ` +
          "Use a discriminated union to represent domain state. " +
          "Predicate functions (is*/has*/can*) are exempt."
        );
      }
    }
  }
  
  return violations;
}

function detectResultPatterns(code, config) {
  if (!config.rules.resultPatterns.enabled) return [];
  
  const violations = [];
  const bannedNames = config.rules.resultPatterns.bannedNames || [];
  const pattern = new RegExp(`(?:readonly\\s+)?(${bannedNames.join('|')})\\s*:\\s*boolean`, 'g');
  
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(line)) !== null) {
      violations.push(
        `RESULT PATTERN: '${match[1]}: boolean' on line ${i + 1}.\n` +
        `    Use discriminated union: {kind: 'success', ...} | {kind: 'failure', reason: string}`
      );
    }
  }
  
  return violations;
}

function detectIfOnField(code, config) {
  if (!config.rules.ifOnField.enabled) return [];
  
  const violations = [];
  const suspiciousNames = new Set(config.rules.ifOnField.suspiciousNames || []);
  const IF_ON_FIELD = /\bif\s*\(\s*\w+\.(\w+)\s*(?:[><=!]+\s*(?:\d+|true|false|"[^"]*"))?\s*\)/g;
  
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    IF_ON_FIELD.lastIndex = 0;
    while ((match = IF_ON_FIELD.exec(line)) !== null) {
      const fieldName = match[1];
      if (suspiciousNames.has(fieldName)) {
        violations.push(
          `IF-ON-FIELD: 'if (result.${fieldName})' on line ${i + 1}.\n` +
          `    '${fieldName}' should be a variant discriminator, not a field check.\n` +
          `    Use: switch (result.kind) { case 'success': ... case 'failure': ... }`
        );
      }
    }
  }
  
  return violations;
}

function detectAnyUnknown(code, config) {
  if (!config.rules.anyUnknown.enabled) return [];
  
  const violations = [];
  
  const anyCount = (code.match(/:\s*any\b/g) || []).length;
  if (anyCount > 0) {
    violations.push(
      `BANNED: 'any' type detected (${anyCount} occurrence(s)). ` +
      "Use explicit types or generics with constraints."
    );
  }
  
  const tauriExemptUnknown = hasTauriStoreImport(code);
  let unknownCount = 0;
  const lines = code.split('\n');
  for (const line of lines) {
    // Skip lines with Tauri store references (store.get returns unknown)
    if (tauriExemptUnknown && /store/i.test(line)) continue;
    const matches = line.match(/:\s*unknown\b/g);
    if (matches) unknownCount += matches.length;
  }
  if (unknownCount > 0) {
    violations.push(
      `BANNED: 'unknown' type detected (${unknownCount} occurrence(s)). ` +
      "Use explicit types or discriminated unions."
    );
  }
  
  return violations;
}

function detectTypeAssertions(code, config) {
  if (!config.rules.typeAssertions.enabled) return [];

  const violations = [];
  const allowConst = config.rules.typeAssertions.allowConst !== false;
  const allowBrandedTypes = config.rules.typeAssertions.allowBrandedTypes !== false;
  const allowedTypes = new Set([
    ...(config.rules.typeAssertions.exemptions?.allowedTypes || []),
    ...(config.projectOverrides?.exemptTypes || []),
  ]);
  const tauriExempt = hasTauriStoreImport(code);

  const asAssertions = code.matchAll(/\bas\s+(\w+(?:<[^>]+>)?)\b/g);
  for (const match of asAssertions) {
    const assertedType = match[1];

    if (allowConst && assertedType === 'const') continue;
    if (allowBrandedTypes && /\w+(?:Id|ID)$/.test(assertedType)) continue;
    if (allowedTypes.has(assertedType)) continue;

    // Skip matches inside comments or string literals
    const lineStart = code.lastIndexOf('\n', match.index) + 1;
    const lineEnd = code.indexOf('\n', match.index);
    const line = code.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const trimmed = line.trimStart();

    // Skip single-line comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Skip import renames: `import { X as Y }`
    if (trimmed.startsWith('import ')) continue;

    // Skip if the `as` match falls inside a string literal or template literal
    const before = line.slice(0, match.index - lineStart);
    const singleQuotes = (before.match(/'/g) || []).length;
    const doubleQuotes = (before.match(/"/g) || []).length;
    const backticks = (before.match(/`/g) || []).length;
    if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) continue;

    // Skip JSX text content: line has no = or : before the `as` (not an assignment/type context)
    // Real type assertions appear after expressions: `value as Type`, `(x) as T`, `obj.prop as T`
    // English prose: "used as a fallback" — no preceding expression syntax
    const beforeAs = line.slice(0, match.index - lineStart).trimEnd();
    if (beforeAs && !/[)\]\w}>]$/.test(beforeAs)) continue;

    // Exempt type assertions on lines with Tauri store operations
    if (tauriExempt) {
      if (/store\s*\.\s*get\s*\(/i.test(line)) continue;
    }

    violations.push(
      `BANNED: Type assertion 'as ${assertedType}' detected. ` +
      "Type assertions bypass compile-time checks. Use type guards or constructors instead."
    );
  }
  
  const nonNullCount = (code.match(/!\s*(?:\.|;|,|\)|\])/g) || []).length;
  if (nonNullCount > 0) {
    violations.push(
      `BLOCKED: Non-null assertion '!' detected (${nonNullCount} occurrence(s)). '!' should not exist — create discriminated unions upstream that make the value guaranteed.`
    );
  }
  
  return violations;
}

// Splits a type-union RHS on top-level `|`, ignoring pipes nested inside
// `<>` (generics), `()`, `[]`, `{}`, or string literals. Required because
// `Map<A | B, string>` and `("a" | string)` both contain inner `|` chars
// that a naive split would treat as union separators.
function splitTopLevelUnion(s) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inString = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString !== null) {
      if (c === inString && s[i - 1] !== '\\') inString = null;
      current += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; current += c; continue; }
    if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
    else if (c === '>' || c === ')' || c === ']' || c === '}') depth--;
    if (c === '|' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
    } else {
      current += c;
    }
  }
  const last = current.trim();
  if (last) parts.push(last);
  return parts;
}

// Walks forward from `start` to find the first `;` at depth 0 outside any
// string literal. Used to locate the end of a type-alias RHS, which may
// span many lines and contain nested punctuation that would fool a naive
// `code.indexOf(';', start)`.
function findTopLevelSemicolon(code, start) {
  let depth = 0;
  let inString = null;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (inString !== null) {
      if (c === inString && code[i - 1] !== '\\') inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
    else if (c === '>' || c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return i;
  }
  return -1;
}

// Detects type aliases that union a literal-string union with bare `string`.
// TypeScript silently collapses `LiteralUnion | string` to plain `string`,
// destroying exhaustive switching everywhere downstream. We fire only when
// the RHS contains a top-level `string` member AND at least one string
// literal — that distinguishes `"a" | "b" | string` (collapse) from
// `string | number` (legitimate primitive widening, no literal to lose).
function detectStringWideningOfLiteralUnion(code, config) {
  if (config?.rules?.stringWidening?.enabled === false) return [];
  const violations = [];

  const aliasStartRe = /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/g;
  let match;
  while ((match = aliasStartRe.exec(code)) !== null) {
    const aliasName = match[1];
    const rhsStart = match.index + match[0].length;
    const rhsEnd = findTopLevelSemicolon(code, rhsStart);
    if (rhsEnd === -1) continue;
    const rhs = code.slice(rhsStart, rhsEnd);

    const members = splitTopLevelUnion(rhs);
    if (!members.includes('string')) continue;

    const hasStringLiteral = /"[^"]*"|'[^']*'/.test(rhs);
    if (!hasStringLiteral) continue;

    const aliasStartLine = code.slice(0, match.index).split('\n').length;
    violations.push(
      `STRING WIDENING: type '${aliasName}' on line ${aliasStartLine} unions a literal-string union with bare \`string\`.\n` +
      `    TypeScript silently collapses \`LiteralUnion | string\` to plain \`string\`. Every exhaustive \`switch\` over '${aliasName}' becomes unsafe with no compile warning.\n` +
      `    Common cause: the wire packet / boundary value lacks a typed field, so the consumer added \`| string\` to make it compile.\n` +
      `    Fix: widen the upstream wire / source type to carry the real typed kind, then keep '${aliasName}' narrow (drop the \`| string\`). Pass the real typed value through unmodified.\n` +
      `    If the value genuinely is freeform-text-with-hint-literals (autocomplete API), accept the violation; @why is not a bypass per the why-tag canonical spec.`
    );
  }

  return violations;
}

function detectDoubleBang(code, config) {
  if (!config.rules.doubleBang.enabled) return [];
  const violations = [];
  
  const doubleBangCount = (code.match(/!!\w+/g) || []).length;
  if (doubleBangCount > 0) {
    violations.push(
      `BANNED: Double-bang coercion '!!' detected (${doubleBangCount} occurrence(s)). ` +
      "This creates boolean blindness. Use explicit discriminated unions."
    );
  }
  
  return violations;
}

function detectEnumKeyword(code, config) {
  if (!config.rules.enums.enabled) return [];
  
  const violations = [];
  
  const enums = code.matchAll(/\benum\s+(\w+)/g);
  for (const match of enums) {
    const enumName = match[1];
    violations.push(
      `BANNED: 'enum ${enumName}' detected. TypeScript enums are just numbers. ` +
      `Use discriminated unions instead: type ${enumName} = {kind: 'variantA'} | {kind: 'variantB'}`
    );
  }
  
  return violations;
}

function detectNonExhaustiveSwitches(code, config) {
  if (!config.rules.exhaustiveSwitches.enabled) return [];

  const violations = [];

  const switchStarts = code.matchAll(/switch\s*\([^)]+\)\s*\{/g);
  for (const match of switchStarts) {
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < code.length && depth > 0) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
      i++;
    }
    const switchBody = code.slice(bodyStart, i - 1);

    const hasDefault = /\bdefault\s*:/.test(switchBody);
    if (!hasDefault) {
      violations.push(
        "NON-EXHAUSTIVE SWITCH: Switch statement without 'default' case. " +
        "Add a default case to handle unexpected values."
      );
    }
  }

  return violations;
}

// @why FALL-THROUGH GROUPING enforces the branch-fan-out rule from the
// degenerate-collapse class (`.claude/CLAUDE.md`): three case labels
// stacked over one body without explicit acknowledgment is a smell.
// Either the cases really are the same operation, in which case the DU
// upstream should collapse them into one variant; or the cases differ
// (different field access, different telemetry, different next-state),
// in which case fan them out with one body per case (even if every body
// is just `break;`). The detector flags every case that immediately
// precedes another `case`/`default` label with no intervening
// statement; comments are stripped first so a comment between cases
// does not mask the grouping.
function detectFallthroughGrouping(code, config) {
  if (config.rules?.fallthroughGrouping?.enabled === false) return [];

  const violations = [];
  const stripped = code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const switchStarts = stripped.matchAll(/switch\s*\([^)]+\)\s*\{/g);
  for (const match of switchStarts) {
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < stripped.length && depth > 0) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') depth--;
      i++;
    }
    const switchBody = stripped.slice(bodyStart, i - 1);

    const groupedCaseRe = /case\s+([^:{}\n]+?)\s*:\s*(?=case\b|default\s*:)/g;
    let cm;
    while ((cm = groupedCaseRe.exec(switchBody)) !== null) {
      const label = cm[1].trim();
      violations.push(
        `FALLTHROUGH GROUPING: case \`${label}:\` falls through to the next ` +
        `label with no body. Per branch-fan-out rule, every case body must ` +
        `be explicit (even if it is just \`break;\`). If multiple cases truly ` +
        `do the same thing, that is a hint they should collapse into one DU ` +
        `variant upstream; if they don't (different field access, different ` +
        `telemetry, different next-state), fan them out one body per case.`
      );
    }
  }

  return violations;
}

function findMatchingBrace(code, openBraceIndex) {
  let depth = 1;
  let i = openBraceIndex + 1;
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') depth--;
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

function findSwitchSpans(code) {
  const switches = [];
  const switchRe = /switch\s*\(([^)]*)\)\s*\{/g;
  let match;
  while ((match = switchRe.exec(code)) !== null) {
    const openBraceIndex = match.index + match[0].length - 1;
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex === -1) continue;
    switches.push({
      expression: match[1].trim(),
      start: match.index,
      bodyStart: openBraceIndex + 1,
      bodyEnd: closeBraceIndex,
    });
  }
  return switches;
}

function isDiscriminantSwitchExpression(expression) {
  return /\.[Kk]ind\b|\.[Tt]ype\b/.test(expression);
}

function stripTsComments(code) {
  return code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function caseBodiesInSwitchBody(switchBody) {
  const cases = [];
  const caseRe = /\bcase\s+([^:]+):\s*([\s\S]*?)(?=\bcase\s+|\bdefault\s*:|$)/g;
  let caseMatch;
  while ((caseMatch = caseRe.exec(switchBody)) !== null) {
    cases.push({
      label: caseMatch[1].trim(),
      body: caseMatch[2],
    });
  }
  return cases;
}

function repeatedReturnKindsInSwitchBody(switchBody) {
  const counts = new Map();
  for (const switchCase of caseBodiesInSwitchBody(switchBody)) {
    const body = switchCase.body;
    const returnKind = body.match(/\breturn\s+\{\s*Kind\s*:\s*["']([^"']+)["']/);
    if (!returnKind) continue;
    const kind = returnKind[1];
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return counts;
}

// @why PRODUCT SWITCH MATRIX catches the pattern that satisfies exhaustive
// switch rules while still hand-writing a previous x next DU matrix. When an
// inner discriminant switch repeats the same returned `{ Kind: "..." }` across
// many cases, the product relationship is missing as a named DU upstream.
function detectProductSwitchMatrix(code, config) {
  if (config.rules?.productSwitchMatrix?.enabled === false) return [];

  const violations = [];
  const minRepeated = config.rules?.productSwitchMatrix?.minRepeatedReturnKind || 3;
  const switches = findSwitchSpans(code);

  for (const outerSwitch of switches) {
    if (!isDiscriminantSwitchExpression(outerSwitch.expression)) continue;

    for (const innerSwitch of switches) {
      if (innerSwitch.start <= outerSwitch.start) continue;
      if (innerSwitch.bodyEnd > outerSwitch.bodyEnd) continue;
      if (!isDiscriminantSwitchExpression(innerSwitch.expression)) continue;

      const innerBody = code.slice(innerSwitch.bodyStart, innerSwitch.bodyEnd);
      const repeatedReturnKinds = repeatedReturnKindsInSwitchBody(innerBody);
      for (const [returnedKind, count] of repeatedReturnKinds.entries()) {
        if (count < minRepeated) continue;
        violations.push(
          `PRODUCT SWITCH MATRIX: nested discriminant switch starting on line ${lineNumberAt(code, innerSwitch.start)} ` +
          `returns { Kind: "${returnedKind}" } from ${count} case bodies.\n` +
          `    This is a hand-written product matrix over two DUs. Classify the previous/next relationship once into a relationship DU, then switch on that relationship.\n` +
          `    If the caller only needs executable side effects, compile the rich transition into an actionable command shape and keep no-op variants out of the side-effect runner.`
        );
      }
    }
  }

  return violations;
}

function lineNumberAt(code, index) {
  return code.slice(0, index).split('\n').length;
}

function skipWhitespace(code, index) {
  let i = index;
  while (i < code.length && /\s/.test(code[i])) i++;
  return i;
}

function findMatchingDelimiter(code, openIndex, openChar, closeChar) {
  let depth = 0;
  let inString = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIndex; i < code.length; i++) {
    const c = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString !== null) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }

    if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      continue;
    }

    if (c === openChar) depth++;
    if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function scanIfReturnBlocks(code) {
  const blocks = [];
  const ifStartRe = /\bif\s*\(/g;
  let match;

  while ((match = ifStartRe.exec(code)) !== null) {
    const openParen = code.indexOf('(', match.index);
    const closeParen = findMatchingDelimiter(code, openParen, '(', ')');
    if (closeParen === -1) continue;

    const condition = code.slice(openParen + 1, closeParen);
    const blockStart = skipWhitespace(code, closeParen + 1);
    if (code[blockStart] !== '{') continue;

    const blockEnd = findMatchingDelimiter(code, blockStart, '{', '}');
    if (blockEnd === -1) continue;

    const body = code.slice(blockStart + 1, blockEnd);
    if (/\breturn\b/.test(body)) {
      blocks.push({
        start: match.index,
        end: blockEnd + 1,
        line: lineNumberAt(code, match.index),
        condition,
      });
    }

    ifStartRe.lastIndex = blockEnd + 1;
  }

  return blocks;
}

function groupConsecutiveIfBlocks(code, blocks) {
  const groups = [];
  let current = [];

  for (const block of blocks) {
    if (current.length === 0) {
      current = [block];
      continue;
    }

    const previous = current[current.length - 1];
    const gap = code.slice(previous.end, block.start);
    if (/^[\s;]*$/.test(gap)) {
      current.push(block);
      continue;
    }

    groups.push(current);
    current = [block];
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function extractDiscriminantComparisons(condition) {
  const comparisons = [];
  const leftRe = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.(?:kind|Kind|type|_tag|tag))\s*(?:={2,3}|!={1,2})\s*(?:"[^"]*"|'[^']*')/g;
  const rightRe = /(?:"[^"]*"|'[^']*')\s*(?:={2,3}|!={1,2})\s*\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.(?:kind|Kind|type|_tag|tag))/g;
  let match;

  while ((match = leftRe.exec(condition)) !== null) comparisons.push(match[1]);
  while ((match = rightRe.exec(condition)) !== null) comparisons.push(match[1]);
  return comparisons;
}

function extractNullishComparisons(condition) {
  const comparisons = [];
  const leftRe = /\b([A-Za-z_$][\w$]*)\s*(?:={2,3}|!={1,2})\s*(?:null|undefined)\b/g;
  const rightRe = /\b(?:null|undefined)\s*(?:={2,3}|!={1,2})\s*([A-Za-z_$][\w$]*)\b/g;
  let match;

  while ((match = leftRe.exec(condition)) !== null) comparisons.push(match[1]);
  while ((match = rightRe.exec(condition)) !== null) comparisons.push(match[1]);
  return comparisons;
}

function detectStateBranching(code, config) {
  if (config.rules?.stateBranching?.enabled === false) return [];

  const violations = [];
  const elseIfRe = /\belse\s+if\s*\(/g;
  let elseIfMatch;
  while ((elseIfMatch = elseIfRe.exec(code)) !== null) {
    violations.push(
      `IF/ELSE STATE LADDER: 'else if' on line ${lineNumberAt(code, elseIfMatch.index)}.\n` +
      `    State branching must be a discriminated union plus switch statement. ` +
      `Classify the state once, then switch on the variant.`
    );
  }

  const ifBlocks = scanIfReturnBlocks(code);
  const groups = groupConsecutiveIfBlocks(code, ifBlocks);

  for (const group of groups) {
    const discriminants = group.flatMap(block => extractDiscriminantComparisons(block.condition));
    const uniqueDiscriminants = new Set(discriminants);
    if (group.length >= 2 && uniqueDiscriminants.size > 0) {
      violations.push(
        `IF RETURN STATE LADDER: consecutive if/return blocks starting on line ${group[0].line} branch on discriminant field(s) [${[...uniqueDiscriminants].join(', ')}].\n` +
        `    Use switch on the discriminated union variant instead of re-checking '.kind' / '.type' through if statements.`
      );
    }

    const nullishNames = group.flatMap(block => extractNullishComparisons(block.condition));
    const uniqueNullishNames = new Set(nullishNames);
    if (group.length >= 3 && uniqueNullishNames.size >= 2) {
      violations.push(
        `NULLISH COMBINATION LADDER: consecutive if/return blocks starting on line ${group[0].line} enumerate null/undefined combinations for [${[...uniqueNullishNames].join(', ')}].\n` +
        `    Boundary parsing must classify this once into a discriminated union, then switch on that variant. Do not enumerate field-presence subsets with if statements.`
      );
    }
  }

  const ternaryRe = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:={2,3}|!={1,2})\s*(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|"[^"]*"|'[^']*'|null|undefined|true|false)\s*\?/g;
  let ternaryMatch;
  while ((ternaryMatch = ternaryRe.exec(code)) !== null) {
    violations.push(
      `STATE TERNARY: equality ternary on line ${lineNumberAt(code, ternaryMatch.index)}.\n` +
      `    A ternary over equality collapses state into two branches. Use an explicit discriminated union and switch on it.`
    );
  }

  return violations;
}

// Runtime-mandated signatures — the caller is the framework, not your code.
// You cannot wrap these in an object parameter.
const FRAMEWORK_EXEMPT_FUNCTIONS = new Set([
  'fetch', 'scheduled', 'queue', 'tail', 'trace', 'email',  // Cloudflare Workers
  'middleware',                                                // Express/Connect/Koa
  'handler',                                                   // AWS Lambda / serverless
  'reducer',                                                   // Redux / useReducer
  'compare', 'compareFn', 'comparator',                        // Array.sort
  'resolve',                                                   // GraphQL resolvers
  'render',                                                    // React.forwardRef
]);

// extractBalancedParenBody now lives in the canonical hook-lib at
// plugins/hook-lib/lib/parse-function-signature.js (vendored into this
// plugin's lib/) — required at the top of this file. The shared lib also
// exports countTopLevelCommas, which replaces the inline depth-tracking
// loop in detectPositionalArgs below.

// Returns the bracket (`{`, `(`, `[`) that directly encloses `index`, scanning
// backward and skipping balanced inner pairs — or null if `index` is at top
// level.
function enclosingBracketOf(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = code[i];
    if (ch === '}' || ch === ')' || ch === ']') depth++;
    else if (ch === '{' || ch === '(' || ch === '[') {
      if (depth > 0) { depth--; continue; }
      return { char: ch, index: i };
    }
  }
  return null;
}

// @why A `name: (...) => ...` property whose enclosing object literal is
// passed as a call argument is a callback whose parameter signature is
// contextually typed by the callee — `useJakutaResultMutation({ endpointFn:
// (client, args) => ... })` gets `endpointFn`'s shape from the library's
// option type. `positionalArgs` is a "name the args of the API YOU declare"
// rule; a callback handed to someone else's function is not an API the author
// declares, and rewriting it as a params object would break the library
// contract. This is structural and import-free — the skip only applies when
// the code genuinely hands the object to a call, which IS the legitimate
// case. There is nothing to tag or allowlist past: an AI cannot fake "this
// object is a call argument" without actually making it one.
function objectPropertyIsCallArgument(code, propIndex) {
  let pos = propIndex;
  for (let guard = 0; guard < 64; guard++) {
    const enc = enclosingBracketOf(code, pos);
    if (!enc || enc.char !== '{') return false;   // top level, or directly inside ( / [ — not an object property
    const outer = enclosingBracketOf(code, enc.index);
    if (!outer) return false;
    if (outer.char === '(') return true;          // object literal is a call argument
    if (outer.char === '{') { pos = enc.index; continue; }  // nested object value — walk up one level
    return false;                                 // array element, or standalone object — author owns it
  }
  return false;
}

function detectPositionalArgs(code, config) {
  const violations = [];
  const exemptPrivate = config?.rules?.positionalArgs?.exemptPrivateFunctions !== false;
  const userExemptFunctions = new Set(config?.rules?.positionalArgs?.exemptFunctions || []);

  // Header-only patterns: each captures the function name and stops at the
  // opening `(`. The body is then balance-walked. requiresArrowAfterParen
  // marks the arrow-fn shape where we additionally verify the `=>` follows
  // the closing paren so we don't catch parenthesized expressions.
  const functionPatterns = [
    { re: /function\s+(\w+)\s*<[^>]*>?\s*\(/g, requiresArrowAfterParen: false },
    { re: /function\s+(\w+)\s*\(/g, requiresArrowAfterParen: false },
    { re: /(?:const|let|var)\s+(\w+)\s*=\s*\(/g, requiresArrowAfterParen: true },
    { re: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*<[^>]*>?\s*\(/g, requiresArrowAfterParen: false },
    { re: /(constructor)\s*\(/g, requiresArrowAfterParen: false },
    { re: /(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(/g, requiresArrowAfterParen: false, requiresMethodBraceAfterParen: true },
  ];
  
  const seen = new Set();
  for (const pattern of functionPatterns) {
    const { re, requiresArrowAfterParen, requiresMethodBraceAfterParen } = pattern;
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(code)) !== null) {
      const fnName = match[1];
      const openParenIndex = match.index + match[0].length - 1;
      const extracted = extractBalancedParenBody(code, openParenIndex);
      if (!extracted) continue;

      // Validate trailing tokens for shapes that need them. Without this
      // the class-method pattern would match every parenthesized expression.
      if (requiresArrowAfterParen) {
        const after = code.slice(extracted.endIndex).match(/^\s*(?::\s*[^={}\n]+)?\s*=>/);
        if (!after) continue;
      }
      if (requiresMethodBraceAfterParen) {
        const after = code.slice(extracted.endIndex).match(/^\s*(?::\s*\S+)?\s*\{/);
        if (!after) continue;
      }

      let paramsRaw = extracted.body.trim().replace(/,\s*$/, '');

      // Skip empty params
      if (!paramsRaw) continue;

      // Skip control flow keywords caught by class method regex
      if (fnName === 'function' || fnName === 'if' || fnName === 'for' || fnName === 'while' || fnName === 'switch') continue;

      // Deduplicate: multiple regexes can match the same declaration
      const dedupeKey = `${fnName}:${paramsRaw}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Skip private functions (starting with _), but never skip constructors
      if (fnName !== 'constructor' && exemptPrivate && fnName.startsWith('_')) continue;

      // Skip framework-mandated signatures (runtime calls these positionally)
      if (FRAMEWORK_EXEMPT_FUNCTIONS.has(fnName) || userExemptFunctions.has(fnName)) continue;

      // Count commas at depth 0 (ignore nested generics/objects). Logic
      // lives in the canonical hook-lib (countTopLevelCommas), which also
      // owns the arrow-token guard so `=>` is not read as a closing angle
      // bracket. paramCount is one more than the comma count.
      const paramCount = paramsRaw ? countTopLevelCommas(paramsRaw) + 1 : 0;

      // Block if >1 parameter
      if (paramCount > 1) {
        if (fnName === 'constructor') {
          violations.push(
            `POSITIONAL ARGS: Constructor has ${paramCount} positional parameters. ` +
            `Constructors with >1 parameter MUST take a config object: ` +
            `type Config = { ... }; constructor(config: Config) { ... }. ` +
            `This eliminates argument order bugs entirely.`
          );
        } else {
          const structName = fnName.charAt(0).toUpperCase() + fnName.slice(1) + 'Params';
          violations.push(
            `POSITIONAL ARGS: Function '${fnName}' has ${paramCount} positional parameters. ` +
            `Functions with >1 parameter MUST use an object: ` +
            `type ${structName} = { ... }; function ${fnName}(params: ${structName}) { ... }. ` +
            `This eliminates argument order bugs entirely.`
          );
        }
      }
    }
  }
  
  // Also check arrow functions in object methods
  const methodHeaderPattern = /(\w+)\s*:\s*\(/g;
  let match;
  while ((match = methodHeaderPattern.exec(code)) !== null) {
    const methodName = match[1];
    const openParenIndex = match.index + match[0].length - 1;
    const extracted = extractBalancedParenBody(code, openParenIndex);
    if (!extracted) continue;
    const after = code.slice(extracted.endIndex).match(/^\s*(?::\s*[^={}\n]+)?\s*=>/);
    if (!after) continue;
    let paramsRaw = extracted.body.trim().replace(/,\s*$/, '');

    if (!paramsRaw) continue;

    // Skip callbacks contextually typed by a callee — a `name: (...) => ...`
    // property inside an object literal passed as a call argument. The author
    // does not declare that signature; the library being called does.
    if (objectPropertyIsCallArgument(code, match.index)) continue;

    // Skip private methods (starting with _)
    if (exemptPrivate && methodName.startsWith('_')) continue;

    // Skip framework-mandated signatures
    if (FRAMEWORK_EXEMPT_FUNCTIONS.has(methodName) || userExemptFunctions.has(methodName)) continue;

    let depth = 0;
    let paramCount = 1;
    let i = 0;
    while (i < paramsRaw.length) {
      const char = paramsRaw[i];
      if (char === '=' && paramsRaw[i + 1] === '>') { i += 2; continue; }
      if (char === '<' || char === '(' || char === '{' || char === '[') depth++;
      else if (char === '>' || char === ')' || char === '}' || char === ']') depth--;
      else if (char === ',' && depth === 0) paramCount++;
      i++;
    }
    
    if (paramCount > 1) {
      const structName = methodName.charAt(0).toUpperCase() + methodName.slice(1) + 'Params';
      violations.push(
        `POSITIONAL ARGS: Method '${methodName}' has ${paramCount} positional parameters. ` +
        `Use an object: type ${structName} = { ... }; ${methodName}: (params: ${structName}) => ... ` +
        `This eliminates argument order bugs.`
      );
    }
  }
  
  return violations;
}

// ── Cluster rules (structural, from No Boilerplate z-0-bbc80JM) ───────
// BOOL CLUSTER: 2+ boolean fields = sum type (dead-cat-hungry pattern).
// SAME-TYPE CLUSTER: 3+ fields of identical non-primitive type (or 5+ of
// a primitive) in one interface/type = a collection in disguise. Both
// rules look at TYPES, not identifier spelling, so rename-proof.

function extractTsTypeBlocks(code) {
  const results = [];
  const TYPE_START = /(?:export\s+)?(?:interface|type)\s+(\w+)[^{=]*(?:=\s*)?\{/g;
  let match;
  while ((match = TYPE_START.exec(code)) !== null) {
    const name = match[1];
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < code.length && depth > 0) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
      i++;
    }
    const body = code.slice(bodyStart, i - 1);
    const fields = extractTsTopLevelFields(body);
    results.push({ name, fields });
  }
  return results;
}

function extractTsTopLevelFields(body) {
  const fields = [];
  const topLevel = [];
  let current = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '{' || ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === '>' || ch === ')' || ch === ']') depth--;
    if (depth === 0 && (ch === ';' || ch === '\n' || ch === ',')) {
      if (current.trim()) topLevel.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) topLevel.push(current.trim());
  for (const entry of topLevel) {
    const m = entry.match(/^(?:readonly\s+)?(\w+)\s*\??\s*:\s*(.+)$/);
    if (m) fields.push({ name: m[1], type: m[2].trim() });
  }
  return fields;
}

function detectBoolCluster(code) {
  const violations = [];
  for (const { name, fields } of extractTsTypeBlocks(code)) {
    const bools = fields.filter(f => /^boolean\b/.test(f.type)).map(f => f.name);
    if (bools.length >= 2) {
      violations.push(
        `BOOL CLUSTER: '${name}' has ${bools.length} boolean fields [${bools.join(', ')}]. ` +
        `${bools.length} bools = 2^${bools.length} representable combinations, most of them invalid. ` +
        `Replace with a discriminated union carrying only valid combinations. (The "dead cat can't be hungry" pattern from No Boilerplate z-0-bbc80JM.)`
      );
    }
  }
  return violations;
}

const TS_PRIMITIVES = new Set(['string', 'number', 'boolean', 'bigint', 'symbol', 'undefined', 'null']);

function detectSameTypeCluster(code) {
  const violations = [];
  for (const { name, fields } of extractTsTypeBlocks(code)) {
    const byType = new Map();
    for (const f of fields) {
      const t = f.type.trim();
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(f.name);
    }
    for (const [type, fs] of byType) {
      const threshold = TS_PRIMITIVES.has(type.toLowerCase()) ? 5 : 3;
      if (fs.length >= threshold) {
        violations.push(
          `SAME-TYPE CLUSTER: '${name}' has ${fs.length} fields of identical type '${type}' [${fs.join(', ')}]. ` +
          `Structural repeating group: use \`${type}[]\`, \`Record<Key, ${type}>\`, or a tuple. ` +
          `${fs.length} fields × same type = a collection pretending to be named slots. Rename-proof: looks at types, not identifiers.`
        );
      }
    }
  }
  return violations;
}

// ── Degenerate collapse (v1.28.0) ────────────────────────────────────
// Comparator-named function returning boolean or a 2-tag string-literal
// union over typed (non-primitive, non-branded) inputs is a degenerate
// collapse: the answer destroys variant info the inputs already carry,
// forcing the caller to recover via nested switches on the inputs. The
// fix is a relationship DU (e.g. SlotTransition with NoTransition /
// ActivateOnly / DeactivateOnly / SwapSlots) the caller switches on flat.

const COLLAPSE_NAME_RE = /^(compare|diff|equals?|same|isSame|isEqual|matches?|isMatch|areSame|areEqual)([A-Z]|$)/;
const TS_PRIMITIVE_TYPE_RE = /^(string|number|boolean|bigint|symbol|undefined|null|void|never|any|unknown|object)\b/;
const BRANDED_ID_RE = /(Id|ID|Uuid|UUID|Hash|Token)$/;

function detectDegenerateCollapse(code, config) {
  if (config?.rules?.degenerateCollapse?.enabled === false) return [];
  const userExempt = new Set(config?.rules?.degenerateCollapse?.exemptFunctions || []);
  const violations = [];

  const fnPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(/g,
  ];

  const seen = new Set();
  for (const pattern of fnPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const fnName = match[1];
      if (!COLLAPSE_NAME_RE.test(fnName)) continue;
      if (userExempt.has(fnName)) continue;
      if (FRAMEWORK_EXEMPT_FUNCTIONS.has(fnName)) continue;
      if (fnName.startsWith('_')) continue;

      const openParenIndex = match.index + match[0].length - 1;
      const extracted = extractBalancedParenBody(code, openParenIndex);
      if (!extracted) continue;

      const after = code.slice(extracted.endIndex);
      const returnMatch = after.match(/^\s*:\s*([^={\n]+?)(?:\s*=>|\s*\{)/);
      if (!returnMatch) continue;
      const returnType = returnMatch[1].trim();

      const isBool = /^boolean\b/.test(returnType);
      const isTwoTagDU = /^"[^"]+"\s*\|\s*"[^"]+"$/.test(returnType);
      if (!isBool && !isTwoTagDU) continue;

      const paramTypes = [];
      const typeMatches = extracted.body.matchAll(/:\s*([A-Za-z_][\w<>[\],\s.]*?)(?=[,)=]|$)/g);
      for (const tm of typeMatches) {
        const t = tm[1].trim();
        if (!t) continue;
        if (TS_PRIMITIVE_TYPE_RE.test(t)) continue;
        if (BRANDED_ID_RE.test(t)) continue;
        paramTypes.push(t);
      }
      if (paramTypes.length === 0) continue;

      const dedupeKey = `${fnName}:${returnType}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      violations.push(
        `DEGENERATE COLLAPSE: Function '${fnName}' returns '${returnType}' over typed input(s) [${paramTypes.join(', ')}].\n` +
        `    A 2-state answer over a richer input destroys "how they differ"; callers re-derive the lost cases by switching on the inputs again, which produces nested switches and tempts more comparators.\n` +
        `    Fix: return a relationship discriminated union whose variants enumerate the real outcomes (e.g. SlotTransition with NoTransition / ActivateOnly / DeactivateOnly / SwapSlots). Callers switch flat on '.kind'. Delete the comparator.\n` +
        `    Trace back to the boundary where the values entered the system; the type at the boundary is the type the runtime should mirror. If a richer DU does not yet exist, define it.\n` +
        `    Exempt by adding '${fnName}' to rules.degenerateCollapse.exemptFunctions in .claude/ai-lab/perfect-typescripter/config.json (only when the input is genuinely opaque).`
      );
    }
  }
  return violations;
}

// ── Phantom type parameter (v1.33.0) ──────────────────────────────────
// A generic type parameter declared in a `<...>` list but never referenced
// anywhere in the body of the declaration is phantom: it pretends to
// constrain the type but does not. WorldStateRegistry<TKind, TUpsert,
// TRemoveAnnouncement> with a body that only uses TUpsert and
// TRemoveAnnouncement lets callers pass any value for TKind and the type
// system will not object — the registry has no relationship to its
// declared "kind". The fix is either to USE the param (mapped types over
// it, fields whose type is derived from it, constraints involving it) or
// to REMOVE it. The detector counts `\bNAME\b` occurrences across the
// declaration text (header through closing brace / semicolon). If the
// count is exactly 1 (the declaration site only), the param is phantom.
//
// Comments and string literals are stripped before counting so a
// reference inside a comment doesn't satisfy the check. Constraints that
// USE other params count as a usage of those other params (e.g.
// `<K extends keyof T>` uses T but does not use K — K must appear
// elsewhere or it is phantom).
//
// Exemption shapes:
//   - rules.phantomTypeParams.exemptions.typeParamNames: ["P"] — names
//     allowed to be phantom (rare; phantom-by-design branded markers).
//   - rules.phantomTypeParams.exemptions.commentTag: "@why phantom" on
//     the declaration line.

function extractBalancedAngleBody(code, openIdx) {
  if (code[openIdx] !== '<') return null;
  let depth = 1;
  let i = openIdx + 1;
  while (i < code.length && depth > 0) {
    const c = code[i];
    if (c === '<') depth++;
    else if (c === '>') {
      depth--;
      if (depth === 0) {
        return { body: code.slice(openIdx + 1, i), endIndex: i + 1 };
      }
    }
    i++;
  }
  return null;
}

function parseTypeParamNames(angleBody) {
  const parts = [];
  let current = '';
  let depth = 0;
  for (const c of angleBody) {
    if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
    else if (c === '>' || c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      const t = current.trim();
      if (t) parts.push(t);
      current = '';
    } else {
      current += c;
    }
  }
  const last = current.trim();
  if (last) parts.push(last);

  const names = [];
  for (const part of parts) {
    const m = part.match(/^(\w+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

// Walks a type-alias RHS to its terminating `;` while honoring brace,
// paren, bracket, and angle balance. Crucially, `=>` is skipped as a
// token so the arrow's `>` does not decrement angle depth — the bug
// findTopLevelSemicolon has when applied to type aliases that contain
// arrow function types.
function findTypeAliasEnd(code, start) {
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let angleDepth = 0;
  let i = start;
  while (i < code.length) {
    const c = code[i];
    if (c === '=' && code[i + 1] === '>') { i += 2; continue; }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if (c === '(') parenDepth++;
    else if (c === ')') parenDepth--;
    else if (c === '[') bracketDepth++;
    else if (c === ']') bracketDepth--;
    else if (c === '<') angleDepth++;
    else if (c === '>') angleDepth--;
    else if (c === ';' &&
             braceDepth === 0 && parenDepth === 0 &&
             bracketDepth === 0 && angleDepth === 0) {
      return i + 1;
    }
    i++;
  }
  return -1;
}

function findDeclarationEnd(code, kind, afterAngleClose) {
  if (kind === 'type') {
    return findTypeAliasEnd(code, afterAngleClose);
  }
  let i = afterAngleClose;
  // Functions have a `(...)` parameter list before the body. Skip past
  // it via balanced-paren extraction so an inline-object type annotation
  // inside a parameter (e.g. `arg: { x: T }`) does not get mistaken for
  // the body's opening brace.
  if (kind === 'function') {
    while (i < code.length && code[i] !== '(') i++;
    if (i >= code.length) return -1;
    const parenBody = extractBalancedParenBody(code, i);
    if (!parenBody) return -1;
    i = parenBody.endIndex;
  }
  while (i < code.length && code[i] !== '{') i++;
  if (i >= code.length) return -1;
  let depth = 1;
  i++;
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') depth--;
    i++;
  }
  return i;
}

function detectPhantomTypeParams(code, config) {
  if (config?.rules?.phantomTypeParams?.enabled === false) return [];

  const exemptNames = new Set(config?.rules?.phantomTypeParams?.exemptions?.typeParamNames || []);

  const violations = [];

  const stripped = code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  const DECL_RE = /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(type|interface|class|function)\s+(\w+)\s*</g;
  let match;
  while ((match = DECL_RE.exec(stripped)) !== null) {
    const kind = match[1];
    const name = match[2];
    const angleOpenIdx = match.index + match[0].length - 1;

    const angleBody = extractBalancedAngleBody(stripped, angleOpenIdx);
    if (!angleBody) continue;

    const declStart = match.index;
    const declEnd = findDeclarationEnd(stripped, kind, angleBody.endIndex);
    if (declEnd === -1) continue;

    const declText = stripped.slice(declStart, declEnd);

    const paramNames = parseTypeParamNames(angleBody.body);

    for (const param of paramNames) {
      if (exemptNames.has(param)) continue;

      const wordRe = new RegExp(`\\b${param}\\b`, 'g');
      const matches = declText.match(wordRe) || [];
      if (matches.length <= 1) {
        const lineNum = stripped.slice(0, declStart).split('\n').length;
        violations.push(
          `PHANTOM TYPE PARAMETER: ${kind} '${name}' on line ${lineNum} declares generic param '${param}' that is never referenced in the body.\n` +
          `    A phantom param doesn't constrain anything. ` +
          `'${name}<X, ...>' and '${name}<Y, ...>' are interchangeable for any X / Y, ` +
          `so callers can pass any value for '${param}' and the type system won't object.\n` +
          `    If '${param}' is meant to discriminate variants, derive its dependents from it via mapped / conditional types ` +
          `(e.g. \`{[K in ${param}]: PayloadFor<K>}\`). If '${param}' is a tag with no derivation, it can't enforce anything — remove it.\n` +
          `    Fix: USE '${param}' in a field type, parameter type, return type, constraint, or mapped/conditional type. Otherwise REMOVE it from the generic list.\n` +
          `    If '${param}' is a project-wide convention (e.g. a branded-marker name), list it in rules.phantomTypeParams.exemptions.typeParamNames; @why is not a per-site bypass per the why-tag canonical spec.`
        );
      }
    }
  }

  return violations;
}

function isFileExempt(filePath, ruleExemptions) {
  if (!ruleExemptions) return false;
  const basename = path.basename(filePath);
  if (ruleExemptions.allowedFiles && ruleExemptions.allowedFiles.includes(basename)) {
    return true;
  }
  if (ruleExemptions.allowedDirectories) {
    const normalized = filePath.replace(/\\/g, '/');
    for (const dir of ruleExemptions.allowedDirectories) {
      const normalizedDir = dir.replace(/\\/g, '/');
      if (normalized.includes(normalizedDir)) return true;
    }
  }
  return false;
}

function detectViolations(code, filePath, config) {
  const violations = [];

  const isTsx = filePath.endsWith('.tsx');

  if (!isFileExempt(filePath, config.rules.nullUndefined?.exemptions)) {
    violations.push(...detectNullUndefined(code, config));
  }
  if (!isTsx || !config.rules.optionalProperties?.exemptions?.tsxFiles) {
    if (!isFileExempt(filePath, config.rules.optionalProperties?.exemptions)) {
      violations.push(...detectOptionalProperties(code, config));
    }
  }
  if (!isFileExempt(filePath, config.rules.optionalChaining?.exemptions)) {
    violations.push(...detectOptionalChaining(code, config));
  }

  if (!isTsx || !config.rules.booleanFields.exemptions?.tsxFiles) {
    if (!isFileExempt(filePath, config.rules.booleanFields?.exemptions)) {
      violations.push(...detectBooleanFields(code, config));
    }
    if (!isFileExempt(filePath, config.rules.booleanParams?.exemptions)) {
      violations.push(...detectBooleanParams(code, config));
    }
    if (!isFileExempt(filePath, config.rules.booleanReturns?.exemptions)) {
      violations.push(...detectBooleanReturns(code, config));
    }
  }

  if (!isFileExempt(filePath, config.rules.resultPatterns?.exemptions)) {
    violations.push(...detectResultPatterns(code, config));
  }
  violations.push(...detectIfOnField(code, config));

  if (!isFileExempt(filePath, config.rules.anyUnknown?.exemptions) &&
      !isFileExempt(filePath, config.rules.unknownType?.exemptions)) {
    violations.push(...detectAnyUnknown(code, config));
  }

  if (!isFileExempt(filePath, config.rules.typeAssertions?.exemptions)) {
    violations.push(...detectTypeAssertions(code, config));
  }

  if (!isFileExempt(filePath, config.rules.stringWidening?.exemptions)) {
    violations.push(...detectStringWideningOfLiteralUnion(code, config));
  }

  if (!isFileExempt(filePath, config.rules.doubleBang?.exemptions)) {
    violations.push(...detectDoubleBang(code, config));
  }
  violations.push(...detectEnumKeyword(code, config));
  violations.push(...detectNonExhaustiveSwitches(code, config));
  violations.push(...detectFallthroughGrouping(code, config));
  violations.push(...detectProductSwitchMatrix(code, config));
  if (!isFileExempt(filePath, config.rules.stateBranching?.exemptions)) {
    violations.push(...detectStateBranching(code, config));
  }
  if (!isFileExempt(filePath, config.rules.positionalArgs?.exemptions)) {
    violations.push(...detectPositionalArgs(code, config));
  }

  violations.push(...detectBoolCluster(code));
  violations.push(...detectSameTypeCluster(code));
  violations.push(...detectDegenerateCollapse(code, config));

  if (!isFileExempt(filePath, config.rules.phantomTypeParams?.exemptions)) {
    violations.push(...detectPhantomTypeParams(code, config));
  }

  return violations;
}

// ── MAIN ───────────────────────────────────────────────────────────────

function main() {
  const input = parseHookInput();
  if (!input) {
    process.stderr.write('Failed to parse input JSON\n');
    process.exit(2);
  }

  const tool = input.toolName;
  const toolInput = input.toolInput;
  if (!isEditOrWrite(tool)) return pass();

  const filePath = input.filePath;
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return pass();
  if (filePath.endsWith('.d.ts')) return pass();

  const content = extractContent(tool, toolInput);
  
  // Load config (walk up from file path to find config)
  let projectRoot = process.cwd();
  if (filePath.includes('/') || filePath.includes('\\')) {
    let dir = path.dirname(filePath);
    const root = path.parse(dir).root || '/';
    while (dir !== root && dir !== '.' && dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.claude', 'ai-lab', 'perfect-typescripter', 'config.json')) ||
          fs.existsSync(path.join(dir, '.perfect-typescripter.json'))) {
        projectRoot = dir;
        break;
      }
      dir = path.dirname(dir);
    }
  }
  
  const config = loadConfig(projectRoot);

  // Check ignorePaths — skip entire directories/files
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const ignorePaths = (config.ignorePaths || []).map(p => (typeof p === 'object' ? p.path || '' : p).replace(/\\/g, '/').toLowerCase());
  for (const ignored of ignorePaths) {
    if (ignored && normalizedPath.includes(ignored)) return pass();
  }

  const violations = detectViolations(content, filePath, config);

  if (violations.length > 0) {
    const configPath = path.join(projectRoot, '.claude', 'ai-lab', 'perfect-typescripter', 'config.json');
    const configExists = fs.existsSync(configPath);

    const sections = [];

    // Config guidance first — this is what the AI needs most
    sections.push(
      `── CONFIG ──\n` +
      `Project config: ${configPath}\n` +
      (configExists
        ? `Config exists — read it to understand current exemptions.`
        : `No config file found.`) +
      `\nIMPORTANT: Do NOT edit the config without asking the user first. Explain which rule fired, why you think it's a false positive, and what exemption you'd add. The user decides — not you. The default action is to fix the types, not add exemptions.` +
      `\nExemption examples:\n` +
      `  nullUndefined → "rules": { "nullUndefined": { "exemptions": { "allowedFiles": ["${path.basename(filePath)}"] } } }\n` +
      `  typeAssertions → "rules": { "typeAssertions": { "exemptions": { "allowedTypes": ["MyBrandedId"] } } }\n` +
      `  booleanFields → "rules": { "booleanFields": { "exemptions": { "fieldNames": ["refreshing"] } } }\n` +
      `  Skip entire dir → "ignorePaths": [{ "path": "src/generated", "reason": "auto-generated" }]\n` +
      `Full schema: read the setup-typescripter-config skill.`
    );

    // Each violation as its own block
    for (let i = 0; i < violations.length; i++) {
      sections.push(`── VIOLATION ${i + 1} ──\n${violations[i]}`);
    }

    // Directive last
    sections.push(
      `── DIRECTIVE ──\n` +
      `Do NOT hack around this hook. Do NOT use \`as\`, wrappers, or type casts to silence it.\n` +
      `Fix the types upstream — create discriminated unions and switch statements so the illegal state cannot exist at the type level.\n` +
      `If this is a false positive (API boundary, framework constraint), add an exemption to the config above. Do NOT silently work around it.`
    );

    return deny(sections.join('\n\n') + '\n');
  }

  return pass();
}

main();
